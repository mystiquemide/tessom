import {createClient} from '@sanity/client'
import {
  createEngine,
  gdrRef,
  type DefinedWorkflow,
  type DeployDefinitionsResult,
  type Engine,
  type FireActionArgs,
  type GlobalDocumentReference,
  type InitialFieldValue,
  type OperationResult,
  type ResolvedFieldEntry,
  type WorkflowClient,
  type WorkflowResource,
  type WorkflowInstance,
} from '@sanity/workflow-engine'
import {defineWorkflow} from '@sanity/workflow-engine/define'

import {remnantLifecycleDefinitionInput} from './definition'

export const WORKFLOW_DEFINITION_NAME = 'remnant-lifecycle'
export const DEFAULT_WORKFLOW_TAG = 'tessom-dev'
export const WORKFLOW_TAGS = ['tessom-dev', 'tessom-prod'] as const
export const WORKFLOW_API_VERSION = '2026-10-01'
export const EXPECTED_MIN_READER_MODEL = 4

export type RemnantLifecycleAuthoringInput = Parameters<typeof defineWorkflow>[0]

export type WorkflowTag = (typeof WORKFLOW_TAGS)[number]
export type WorkflowEnvironment = Readonly<Record<string, string | undefined>>

export interface WorkflowConfig {
  projectId: string
  dataset: string
  token: string
  tag: WorkflowTag
  workflowResource: WorkflowResource
}

export interface WorkflowEngineOptions {
  /** An injected engine is the seam used by local tests and route adapters. */
  engine?: WorkflowEnginePort
  /** An injected client is useful for Sanity test fakes. */
  client?: WorkflowClient
  env?: WorkflowEnvironment
  projectId?: string
  dataset?: string
  tag?: WorkflowTag
}

export type WorkflowEnginePort = Pick<
  Engine,
  'tag' | 'workflowResource' | 'deployDefinitions' | 'startInstance' | 'fireAction' | 'tick'
>

export interface WorkflowOperationOptions extends WorkflowEngineOptions {
  grantsFromPath?: string
  idempotencyKey?: string
  idempotent?: boolean
}

export interface AllocationRect {
  x: number
  y: number
  w: number
  h: number
}

export type AllocationArea = readonly AllocationRect[]

let cachedDefinition: DefinedWorkflow | undefined

/** Validate the local definition with the installed engine authoring API. */
export function getRemnantLifecycleDefinition(): DefinedWorkflow {
  cachedDefinition ??= defineWorkflow(remnantLifecycleDefinitionInput)
  return cachedDefinition
}

export function workflowTagFromEnvironment(env: WorkflowEnvironment = process.env): WorkflowTag | undefined {
  const configured = env.WORKFLOW_TAG?.trim() || DEFAULT_WORKFLOW_TAG
  return isWorkflowTag(configured) ? configured : undefined
}

export function readWorkflowConfig(env: WorkflowEnvironment = process.env): WorkflowConfig | undefined {
  const projectId = env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim()
  const token = env.SANITY_API_WRITE_TOKEN?.trim()
  const dataset = env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production'
  const tag = workflowTagFromEnvironment(env)

  if (!projectId || !token || !tag) return undefined

  return {
    projectId,
    dataset,
    token,
    tag,
    workflowResource: {type: 'dataset', id: `${projectId}.${dataset}`},
  }
}

export function isWorkflowTag(value: string): value is WorkflowTag {
  return WORKFLOW_TAGS.some((tag) => tag === value)
}

/**
 * Construct the engine for the selected Sanity environment.
 *
 * No client is constructed when project or token configuration is absent. An
 * injected client is treated as an explicit test/runtime dependency and may
 * provide its own credentials, but it still needs project and dataset
 * coordinates to scope workflow documents.
 */
export function createWorkflowEngine(options: WorkflowEngineOptions = {}): WorkflowEnginePort | undefined {
  if (options.engine) return options.engine

  const environment = readWorkflowConfig(options.env)
  const projectId = options.projectId?.trim() || environment?.projectId
  const dataset = options.dataset?.trim() || environment?.dataset || 'production'
  const tag = options.tag || environment?.tag

  if (!projectId || !tag || !isWorkflowTag(tag)) return undefined
  if (!options.client && !environment?.token) return undefined

  const client =
    options.client ??
    createClient({
      projectId,
      dataset,
      token: environment?.token,
      apiVersion: WORKFLOW_API_VERSION,
      useCdn: false,
    })

  return createEngine({
    client,
    tag,
    workflowResource: {type: 'dataset', id: `${projectId}.${dataset}`},
    executionContext: {kind: 'server', id: 'tessom-workflow'},
  })
}

export function consentInstanceId(remnantId: string, tag: WorkflowTag = DEFAULT_WORKFLOW_TAG): string {
  const prefix = `tessom-${tag}-consent-`
  return `${prefix}${stableIdPart(remnantId, 128 - prefix.length)}`
}

export function lifecycleInstanceId(orderId: string, tag: WorkflowTag = DEFAULT_WORKFLOW_TAG): string {
  const prefix = `tessom-${tag}-order-`
  return `${prefix}${stableIdPart(orderId, 128 - prefix.length)}`
}

export interface StartConsentOptions extends WorkflowOperationOptions {
  instanceId?: string
}

export interface StartLifecycleOptions extends WorkflowOperationOptions {
  orderId: string
  allocation: AllocationArea
  instanceId?: string
}

export class UnusableLifecycleInstanceError extends Error {
  readonly instanceId: string

  constructor(instanceId: string) {
    super(`Lifecycle workflow instance is unusable: ${instanceId}`)
    this.name = 'UnusableLifecycleInstanceError'
    this.instanceId = instanceId
  }
}

export async function startConsentInstance(
  remnantId: string,
  options: StartConsentOptions = {},
): Promise<OperationResult | undefined> {
  const engine = createWorkflowEngine(options)
  if (!engine || !nonEmpty(remnantId)) return undefined

  return engine.startInstance({
    definition: WORKFLOW_DEFINITION_NAME,
    instanceId: options.instanceId ?? consentInstanceId(remnantId, workflowTag(engine)),
    context: {mode: 'consent'},
    initialFields: [subjectField(remnantId, engine.workflowResource)],
    grantsFromPath: options.grantsFromPath,
  })
}

export async function startLifecycleInstance(
  remnantId: string,
  options: StartLifecycleOptions,
): Promise<OperationResult | undefined> {
  const engine = createWorkflowEngine(options)
  if (!engine || !nonEmpty(remnantId) || !nonEmpty(options.orderId) || !validAllocation(options.allocation)) {
    return undefined
  }

  const initialFields: InitialFieldValue[] = [
    subjectField(remnantId, engine.workflowResource),
    {type: 'doc.ref', name: 'order', value: gdrRef({res: engine.workflowResource, documentId: options.orderId, type: 'order'})},
    {
      type: 'array',
      name: 'allocation',
      value: options.allocation.map(({x, y, w, h}) => ({x, y, w, h})),
    },
  ]

  return engine.startInstance({
    definition: WORKFLOW_DEFINITION_NAME,
    instanceId: options.instanceId ?? lifecycleInstanceId(options.orderId, workflowTag(engine)),
    context: {mode: 'lifecycle'},
    initialFields,
    grantsFromPath: options.grantsFromPath,
  })
}

export interface PreparedLifecycleAllocation {
  readonly engine: WorkflowEnginePort
  readonly instanceId: string
  readonly started: OperationResult
  readonly idempotencyKey?: string
  readonly grantsFromPath?: string
}

export type LifecycleAllocationOutcome<T> =
  | {
      committed: true
      prepared: PreparedLifecycleAllocation
      value: T
      allocation: OperationResult | undefined
      tick: OperationResult | undefined
    }
  | {
      committed: false
      prepared: PreparedLifecycleAllocation
      orphanedInstanceId: string
      error: unknown
    }

/**
 * Start an order instance before the caller writes its remnant allocation.
 * The deterministic instance id makes a retry resume the same preparation.
 */
export async function prepareLifecycleAllocation(
  remnantId: string,
  options: StartLifecycleOptions,
): Promise<PreparedLifecycleAllocation | undefined> {
  const engine = createWorkflowEngine(options)
  if (!engine || !nonEmpty(remnantId) || !nonEmpty(options.orderId) || !validAllocation(options.allocation)) {
    return undefined
  }

  const instanceId = options.instanceId ?? lifecycleInstanceId(options.orderId, workflowTag(engine))
  const started = await startLifecycleInstance(remnantId, {...options, engine, instanceId})
  if (!started) return undefined
  if (!usableLifecycleInstance(started.instance, remnantId, options, engine)) {
    throw new UnusableLifecycleInstanceError(instanceId)
  }

  return {
    engine,
    instanceId,
    started,
    idempotencyKey: options.idempotencyKey,
    grantsFromPath: options.grantsFromPath,
  }
}

/**
 * Run the guarded content commit after preparation, then advance the workflow.
 * A failed commit leaves the prepared instance in the dataset. The returned
 * orphan id is deliberate so the route can reconcile or abort it later.
 */
export async function finalizeLifecycleAllocation<T>(
  prepared: PreparedLifecycleAllocation,
  commit: (prepared: PreparedLifecycleAllocation) => Promise<T>,
  options: WorkflowOperationOptions = {},
): Promise<LifecycleAllocationOutcome<T>> {
  let value: T
  try {
    value = await commit(prepared)
  } catch (error: unknown) {
    return {
      committed: false,
      prepared,
      orphanedInstanceId: prepared.instanceId,
      error,
    }
  }

  const finalOptions: WorkflowOperationOptions = {
    ...options,
    engine: prepared.engine,
    grantsFromPath: options.grantsFromPath ?? prepared.grantsFromPath,
    idempotencyKey: options.idempotencyKey ?? prepared.idempotencyKey,
  }
  const allocation = await allocateRemnant(prepared.instanceId, finalOptions)
  const tick = await tickWorkflowInstance(prepared.instanceId, finalOptions)

  return {committed: true, prepared, value, allocation, tick}
}

/**
 * Idempotently neutralize a prepared instance after its content commit loses a
 * confirmed pre-commit conflict. The instance remains in the listed stage,
 * with its allocation guard disabled by the abandon action.
 */
export async function abandonPreparedLifecycleAllocation(
  prepared: PreparedLifecycleAllocation,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  const idempotencyKey = options.idempotencyKey ?? `${prepared.idempotencyKey ?? prepared.instanceId}:abandon`
  return abandonLifecycleAllocation(prepared.instanceId, {
    ...options,
    engine: prepared.engine,
    grantsFromPath: options.grantsFromPath ?? prepared.grantsFromPath,
    idempotencyKey,
  })
}

/**
 * Idempotently neutralize a prepared lifecycle instance by its workflow ID.
 * Only the listed-stage abandon action is exposed through this helper.
 */
export async function abandonLifecycleAllocation(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  if (!nonEmpty(instanceId)) return undefined
  const idempotencyKey = options.idempotencyKey ?? `${instanceId}:abandon`
  return fireWorkflowAction(
    {
      instanceId,
      activity: 'abandon',
      action: 'abandon',
      idempotencyKey,
      idempotent: options.idempotent ?? true,
      grantsFromPath: options.grantsFromPath,
    },
    {...options, idempotencyKey},
  )
}

export async function fireWorkflowAction(
  args: FireActionArgs,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  const engine = createWorkflowEngine(options)
  if (!engine || !nonEmpty(args.instanceId) || !nonEmpty(args.activity) || !nonEmpty(args.action)) return undefined
  return engine.fireAction({
    ...args,
    grantsFromPath: args.grantsFromPath ?? options.grantsFromPath,
    idempotencyKey: args.idempotencyKey ?? options.idempotencyKey,
    idempotent: args.idempotent ?? options.idempotent,
  })
}

export async function tickWorkflowInstance(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  const engine = createWorkflowEngine(options)
  if (!engine || !nonEmpty(instanceId)) return undefined
  return engine.tick({instanceId, grantsFromPath: options.grantsFromPath})
}

export async function grantConsent(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireWorkflowAction(
    {instanceId, activity: 'consent', action: 'grant', idempotencyKey: options.idempotencyKey, idempotent: options.idempotent},
    options,
  )
}

export async function declineConsent(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireWorkflowAction(
    {instanceId, activity: 'consent', action: 'decline', idempotencyKey: options.idempotencyKey, idempotent: options.idempotent},
    options,
  )
}

export async function allocateRemnant(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireWorkflowAction(
    {
      instanceId,
      activity: 'allocate',
      action: 'allocate',
      idempotencyKey: options.idempotencyKey,
      idempotent: options.idempotent,
      grantsFromPath: options.grantsFromPath,
    },
    options,
  )
}

export async function markCut(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireProductionAction(instanceId, 'cut', 'mark-cut', options)
}

export async function markSewn(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireProductionAction(instanceId, 'sew', 'mark-sewn', options)
}

export async function markShipped(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireProductionAction(instanceId, 'ship', 'mark-shipped', options)
}

export async function returnShippedToListed(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireProductionAction(instanceId, 'settle', 'return-to-listed', options)
}

export async function closeShippedAsSoldOut(
  instanceId: string,
  options: WorkflowOperationOptions = {},
): Promise<OperationResult | undefined> {
  return fireProductionAction(instanceId, 'settle', 'close-sold-out', options)
}

export async function deployWorkflowDefinitions(
  options: WorkflowEngineOptions = {},
): Promise<DeployDefinitionsResult | undefined> {
  const engine = createWorkflowEngine(options)
  if (!engine) return undefined

  return engine.deployDefinitions({
    expectedMinReaderModel: EXPECTED_MIN_READER_MODEL,
    definitions: [getRemnantLifecycleDefinition()],
  })
}

function fireProductionAction(
  instanceId: string,
  activity: string,
  action: string,
  options: WorkflowOperationOptions,
): Promise<OperationResult | undefined> {
  return fireWorkflowAction(
    {
      instanceId,
      activity,
      action,
      idempotencyKey: options.idempotencyKey,
      idempotent: options.idempotent,
      grantsFromPath: options.grantsFromPath,
    },
    options,
  )
}

function subjectField(remnantId: string, resource: WorkflowResource): InitialFieldValue {
  return {type: 'subject', name: 'subject', value: gdrRef({res: resource, documentId: remnantId, type: 'remnant'})}
}

function validAllocation(value: AllocationArea): boolean {
  return (
    value.length > 0 &&
    value.every(
      (rect) =>
        finite(rect.x) &&
        finite(rect.y) &&
        finite(rect.w) &&
        finite(rect.h) &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.w > 0 &&
        rect.h > 0,
    )
  )
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function usableLifecycleInstance(
  instance: WorkflowInstance,
  remnantId: string,
  options: StartLifecycleOptions,
  engine: WorkflowEnginePort,
): boolean {
  if (
    instance.definition !== WORKFLOW_DEFINITION_NAME ||
    instance.currentStage !== 'listed' ||
    instance.completedAt !== undefined ||
    instance.abortedAt !== undefined ||
    !instance.stages.some((stage) => stage.name === 'listed' && stage.exitedAt === undefined)
  ) {
    return false
  }

  const allocationUsed = uniqueField(instance.fields, 'allocationUsed')
  if (allocationUsed === null || (allocationUsed !== undefined && (allocationUsed._type !== 'boolean' || allocationUsed.value === true))) {
    return false
  }

  const subject = uniqueField(instance.fields, 'subject')
  const expectedSubject = gdrRef({res: engine.workflowResource, documentId: remnantId, type: 'remnant'})
  if (
    subject === null ||
    (subject !== undefined &&
      (subject._type !== 'subject' || !sameReference(subject.value, expectedSubject)))
  ) {
    return false
  }

  const order = uniqueField(instance.fields, 'order')
  const expectedOrder = gdrRef({res: engine.workflowResource, documentId: options.orderId, type: 'order'})
  if (
    order === null ||
    (order !== undefined && (order._type !== 'doc.ref' || !sameReference(order.value, expectedOrder)))
  ) {
    return false
  }

  const allocation = uniqueField(instance.fields, 'allocation')
  return !(
    allocation === null ||
    (allocation !== undefined &&
      (allocation._type !== 'array' || !sameAllocation(allocation.value, options.allocation)))
  )
}

function uniqueField(fields: readonly ResolvedFieldEntry[], name: string): ResolvedFieldEntry | null | undefined {
  const matches = fields.filter((field) => field.name === name)
  return matches.length > 1 ? null : matches[0]
}

function sameReference(value: GlobalDocumentReference | null, expected: GlobalDocumentReference): boolean {
  return value?.id === expected.id && value.type === expected.type
}

function sameAllocation(value: readonly Record<string, unknown>[], expected: AllocationArea): boolean {
  if (value.length !== expected.length) return false

  const remaining = value.slice()
  for (const expectedRect of expected) {
    const match = remaining.findIndex((candidate) => sameRectangle(candidate, expectedRect))
    if (match < 0) return false
    remaining.splice(match, 1)
  }
  return remaining.length === 0
}

function sameRectangle(value: Record<string, unknown>, expected: AllocationRect): boolean {
  return value.x === expected.x && value.y === expected.y && value.w === expected.w && value.h === expected.h
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function stableIdPart(value: string, maxLength: number): string {
  const trimmed = value.trim()
  const readable = trimmed.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'id'
  if (readable === trimmed && readable.length <= maxLength) return readable

  const digest = stableIdDigest(trimmed)
  const available = Math.max(1, maxLength - digest.length - 1)
  return `${readable.slice(0, available)}-${digest}`
}

function stableIdDigest(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
  }

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function workflowTag(engine: WorkflowEnginePort): WorkflowTag {
  return isWorkflowTag(engine.tag) ? engine.tag : DEFAULT_WORKFLOW_TAG
}
