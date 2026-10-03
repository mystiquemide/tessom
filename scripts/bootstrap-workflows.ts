import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'

import type {OperationResult} from '@sanity/workflow-engine'

import {
  consentInstanceId,
  declineConsent,
  grantConsent,
  readWorkflowConfig,
  startConsentInstance,
  tickWorkflowInstance,
  WORKFLOW_DEFINITION_NAME,
  type StartConsentOptions,
  type WorkflowEnvironment,
  type WorkflowTag,
} from '../lib/workflow'
import {createSanityServerClient, type SanityReadClient} from '../lib/sanity/client'
import {SanityDataValidationError} from '../lib/sanity/orders'

/** Project the seeded status needed to align the consent workflow. */
export const REMNANT_IDS_QUERY = `*[_type == $remnantType] | order(_id asc){_id,status}`

/**
 * Consent instances use a deterministic ID prefix. Filtering by that prefix
 * keeps order lifecycle instances out even though both workflows share a
 * definition and tag.
 */
export const CONSENT_INSTANCE_IDS_QUERY =
  `*[_type == $workflowInstanceType && tag == $workflowTag && definition == $workflowDefinition && ` +
  `_id match $consentInstancePattern] | order(_id asc){_id,currentStage,tag,definition}`

const REMNANT_TYPE = 'remnant'
const WORKFLOW_INSTANCE_TYPE = 'sanity.workflow.instance'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

export interface BootstrapResult {
  readonly created: number
  readonly skipped: number
}

export type StartConsentOperation = (
  remnantId: string,
  options: StartConsentOptions,
) => Promise<OperationResult | undefined>

export interface BootstrapDependencies {
  /** Injected in tests so no Sanity network client is constructed. */
  readonly sanityClient?: SanityReadClient
  /** Injected in tests so no workflow engine operation is performed. */
  readonly startConsentInstance?: StartConsentOperation
  readonly grantConsent?: typeof grantConsent
  readonly declineConsent?: typeof declineConsent
  readonly tickWorkflowInstance?: typeof tickWorkflowInstance
}

export interface BootstrapOptions extends BootstrapDependencies {
  readonly env?: WorkflowEnvironment
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function validId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !ID_PATTERN.test(value)) {
    throw new SanityDataValidationError(`Invalid Sanity value for ${field}`)
  }
  return value
}

interface SeededRemnant {
  readonly id: string
  readonly status: 'intake' | 'consented' | 'listed' | 'allocated' | 'sold-out' | 'returned'
}

interface ExistingConsentInstance {
  readonly id: string
  readonly currentStage: string
}

const SEEDED_STATUSES = new Set<SeededRemnant['status']>([
  'intake',
  'consented',
  'listed',
  'allocated',
  'sold-out',
  'returned',
])
const CONSENT_STAGES = new Set(['awaiting-consent', 'listed', 'returned'])

function readRemnants(value: unknown): SeededRemnant[] {
  if (!Array.isArray(value)) throw new SanityDataValidationError('Invalid Sanity value for remnants')

  const ids = new Set<string>()
  const remnants: SeededRemnant[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw new SanityDataValidationError(`Invalid Sanity value for remnants[${index}]`)
    const id = validId(item._id, `remnants[${index}]._id`)
    const status = item.status
    if (typeof status !== 'string' || !SEEDED_STATUSES.has(status as SeededRemnant['status'])) {
      throw new SanityDataValidationError(`Invalid Sanity value for remnants[${index}].status`)
    }
    if (ids.has(id)) throw new SanityDataValidationError('Invalid Sanity value for duplicate remnant ID')
    ids.add(id)
    remnants.push({id, status: status as SeededRemnant['status']})
  }
  return remnants
}

function readInstances(value: unknown): Map<string, ExistingConsentInstance> {
  if (!Array.isArray(value)) throw new SanityDataValidationError('Invalid Sanity value for consent workflow instances')

  const instances = new Map<string, ExistingConsentInstance>()
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) throw new SanityDataValidationError(`Invalid Sanity value for consent workflow instances[${index}]`)
    const id = validId(item._id, `consent workflow instances[${index}]._id`)
    const currentStage = item.currentStage
    if (typeof currentStage !== 'string' || !currentStage.trim() || currentStage.length > 80 || !CONSENT_STAGES.has(currentStage)) {
      throw new SanityDataValidationError(`Invalid Sanity value for consent workflow instances[${index}].currentStage`)
    }
    if (item.tag !== undefined && item.tag !== 'tessom-dev' && item.tag !== 'tessom-prod') {
      throw new SanityDataValidationError(`Invalid Sanity value for consent workflow instances[${index}].tag`)
    }
    if (item.definition !== undefined && item.definition !== WORKFLOW_DEFINITION_NAME) {
      throw new SanityDataValidationError(`Invalid Sanity value for consent workflow instances[${index}].definition`)
    }
    if (instances.has(id)) throw new SanityDataValidationError('Invalid Sanity value for duplicate consent workflow instance ID')
    instances.set(id, {id, currentStage})
  }
  return instances
}

function consentPattern(tag: WorkflowTag): string {
  return `tessom-${tag}-consent-*`
}

function expectedStage(status: SeededRemnant['status']): 'awaiting-consent' | 'listed' | 'returned' {
  if (status === 'intake' || status === 'consented') return 'awaiting-consent'
  if (status === 'returned') return 'returned'
  return 'listed'
}

function bootstrapKey(instanceId: string, action: 'grant' | 'decline'): string {
  return `${instanceId}:${action}:bootstrap`
}

function operationStage(operation: OperationResult | undefined): string | undefined {
  if (!isRecord(operation) || !isRecord(operation.instance)) return undefined
  const stage = operation.instance.currentStage
  return typeof stage === 'string' ? stage : undefined
}

function assertTransition(operation: OperationResult | undefined, tick: OperationResult | undefined, expected: string): void {
  if (operationStage(operation) !== expected && operationStage(tick) !== expected) {
    throw new Error('Invalid consent workflow operation result')
  }
}

function assertStarted(operation: OperationResult | undefined, instanceId: string, tag: WorkflowTag): void {
  // startConsentInstance deliberately returns undefined when its engine is
  // unavailable. Treating that as success would report work that never ran.
  if (operation === undefined || operation === null) {
    throw new Error('Consent workflow operation failed')
  }
  if (!isRecord(operation) || !isRecord(operation.instance) || typeof operation.changed !== 'boolean') {
    throw new Error('Invalid consent workflow operation result')
  }
  const instance = operation.instance
  if (
    instance._id !== instanceId ||
    instance._type !== WORKFLOW_INSTANCE_TYPE ||
    instance.tag !== tag ||
    instance.definition !== WORKFLOW_DEFINITION_NAME ||
    instance.currentStage !== 'awaiting-consent'
  ) {
    throw new Error('Invalid consent workflow operation result')
  }
}

/**
 * Start one consent instance for every remnant without an existing consent
 * instance for the configured workflow tag.
 *
 * An undefined result means server configuration is incomplete. The CLI uses
 * that result to print a safe skip message without constructing a client.
 */
export async function bootstrapConsentWorkflows(
  options: BootstrapOptions = {},
): Promise<BootstrapResult | undefined> {
  const environment = options.env ?? process.env
  const config = readWorkflowConfig(environment)
  if (!config) return undefined

  const sanityClient =
    options.sanityClient ??
    createSanityServerClient({
      ...environment,
      NEXT_PUBLIC_SANITY_DATASET: config.dataset,
    })
  const start = options.startConsentInstance ?? startConsentInstance
  const grant = options.grantConsent ?? grantConsent
  const decline = options.declineConsent ?? declineConsent
  const tick = options.tickWorkflowInstance ?? tickWorkflowInstance

  let remnantProjection: unknown
  let consentProjection: unknown
  try {
    remnantProjection = await sanityClient.fetch(REMNANT_IDS_QUERY, {
      remnantType: REMNANT_TYPE,
    })
    consentProjection = await sanityClient.fetch(CONSENT_INSTANCE_IDS_QUERY, {
      workflowInstanceType: WORKFLOW_INSTANCE_TYPE,
      workflowTag: config.tag,
      workflowDefinition: WORKFLOW_DEFINITION_NAME,
      consentInstancePattern: consentPattern(config.tag),
    })
  } catch {
    // Keep remote client errors, which can contain request details, out of
    // the CLI and out of errors that callers may expose to a user.
    throw new Error('Workflow bootstrap data fetch failed')
  }

  const remnants = readRemnants(remnantProjection)
  const existingInstances = readInstances(consentProjection)

  const expectedPrefix = `tessom-${config.tag}-consent-`
  for (const instanceId of existingInstances.keys()) {
    if (!instanceId.startsWith(expectedPrefix)) {
      throw new SanityDataValidationError('Invalid Sanity value for consent workflow instance ID')
    }
  }

  let created = 0
  let skipped = 0
  for (const remnant of remnants) {
    const instanceId = consentInstanceId(remnant.id, config.tag)
    const targetStage = expectedStage(remnant.status)
    const existing = existingInstances.get(instanceId)
    if (existing?.currentStage === targetStage) {
      skipped += 1
      continue
    }

    if (existing && existing.currentStage !== 'awaiting-consent') {
      throw new SanityDataValidationError('Invalid Sanity value for consent workflow stage and remnant status pair')
    }

    let operation: OperationResult | undefined
    if (!existing) {
      try {
        operation = await start(remnant.id, {
          env: environment,
          tag: config.tag,
          instanceId,
          idempotencyKey: `${instanceId}:start:bootstrap`,
          idempotent: true,
        })
      } catch {
        throw new Error('Consent workflow operation failed')
      }
      assertStarted(operation, instanceId, config.tag)
      created += 1
    } else {
      operation = {
        instance: {
          _id: instanceId,
          _type: WORKFLOW_INSTANCE_TYPE,
          tag: config.tag,
          definition: WORKFLOW_DEFINITION_NAME,
          currentStage: existing.currentStage,
        },
        changed: false,
      } as OperationResult
    }

    if (targetStage === 'awaiting-consent') continue

    const action = targetStage === 'listed' ? 'grant' : 'decline'
    const key = bootstrapKey(instanceId, action)
    let transition: OperationResult | undefined
    try {
      transition = action === 'grant'
        ? await grant(instanceId, {idempotencyKey: key, idempotent: true})
        : await decline(instanceId, {idempotencyKey: key, idempotent: true})
    } catch {
      throw new Error('Consent workflow operation failed')
    }
    let advanced: OperationResult | undefined
    try {
      advanced = await tick(instanceId, {idempotencyKey: key, idempotent: true})
    } catch {
      throw new Error('Consent workflow operation failed')
    }
    assertTransition(transition, advanced, targetStage)
  }

  return {created, skipped}
}

/**
 * CLI adapter. It intentionally logs only fixed messages, so a token or
 * request error cannot reach stdout or stderr through an exception string.
 */
export async function runBootstrapCli(options: BootstrapOptions = {}): Promise<boolean> {
  try {
    const result = await bootstrapConsentWorkflows(options)
    if (!result) {
      console.error('Workflow bootstrap skipped: Sanity project, dataset, token, or workflow tag is not configured.')
      return false
    }

    console.log(`Workflow bootstrap complete: ${result.created} created, ${result.skipped} skipped.`)
    return true
  } catch {
    console.error('Workflow bootstrap failed. Check the Sanity project, dataset, token, and workflow deployment.')
    return false
  }
}

export async function main(): Promise<void> {
  const succeeded = await runBootstrapCli()
  if (!succeeded) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  void main()
}
