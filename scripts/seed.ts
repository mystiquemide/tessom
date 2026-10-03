import {createClient, type PatchOperations} from '@sanity/client'
import {pathToFileURL} from 'node:url'

import {COMMERCE_STATE_DOCUMENT_ID, COMMERCE_STATE_TYPE} from '../lib/sanity/client'
import {owners, remnants, templates, type SeedDefect, type SeedOwner, type SeedRemnant, type SeedTemplate} from './seed-data'

const API_VERSION = '2026-10-01'
const EXPECTED_COUNTS = {owners: 6, templates: 5, remnants: 12} as const

export {COMMERCE_STATE_DOCUMENT_ID, COMMERCE_STATE_TYPE}

export const SEED_REFUSAL_PRODUCTION_ACK = 'Seed refused: production requires ALLOW_PRODUCTION_SEED=1.'
export const SEED_REFUSAL_LIVE_DATA = 'Seed refused: live commerce data exists. Set ALLOW_DESTRUCTIVE_SEED=1 to continue.'
export const SEED_PROBE_FAILED = 'Seed refused: unable to validate the target dataset before mutation.'
export const SEED_PROBE_INVALID = 'Seed refused: the target dataset returned invalid preflight data.'
export const SEED_WRITE_FAILED = 'Seed failed: the Sanity transaction was not completed.'

export const LIVE_STATE_QUERY = `{
  "orders": *[_type == $orderType][0...1]{_id},
  "commerceRemnants": *[_type == $remnantType && (count(allocations) > 0 || status in $commerceStatuses)][0...1]{_id, status, "allocationCount": count(allocations)}
}`

export const LIVE_STATE_PARAMS = {
  orderType: 'order',
  remnantType: 'remnant',
  commerceStatuses: ['allocated', 'sold-out'],
} as const

type SanityReference = {_type: 'reference'; _ref: string}
export type SeedDocument = {_id: string; _type: string; [key: string]: unknown}

export type SeedEnvironment = Readonly<Record<string, string | undefined>>

export interface SeedReadClient {
  fetch<Result>(query: string, params?: Record<string, unknown>): Promise<Result>
  getDocument<Result extends Record<string, unknown> = Record<string, unknown>>(documentId: string): Promise<Result | null | undefined>
}

export interface SeedTransaction {
  create(document: SeedDocument): unknown
  createOrReplace(document: SeedDocument): unknown
  patch(documentId: string, patch: PatchOperations): unknown
  commit(): Promise<unknown>
}

export interface SeedClient extends SeedReadClient {
  transaction(): SeedTransaction
}

export type SeedRunOptions = {
  environment?: SeedEnvironment
  client?: SeedClient
}

export type SeedRunResult = {
  dataset: string
  documentCount: number
  counts: typeof EXPECTED_COUNTS
}

type LiveStateProbe = {
  orders: Array<{_id: string}>
  commerceRemnants: Array<{_id: string; status: string; allocationCount: number}>
}

export type CommerceStateDocument = {
  _id: string
  _type: typeof COMMERCE_STATE_TYPE
  _rev: string
  liveCommerce: boolean
  createdAt: string
  updatedAt: string
}

const reference = (id: string): SanityReference => ({_type: 'reference', _ref: id})

const toOwnerDocument = ({id, ...owner}: SeedOwner): SeedDocument => ({
  _id: id,
  _type: 'owner',
  ...owner,
})

const toTemplateDocument = ({id, pieces, ...template}: SeedTemplate): SeedDocument => ({
  _id: id,
  _type: 'productTemplate',
  ...template,
  pieces: pieces.map(({key, ...piece}) => ({_key: key, _type: 'templatePiece', ...piece})),
})

const toDefect = ({key, ...defect}: SeedDefect) => ({_key: key, _type: 'defect', ...defect})

const toRemnantDocument = ({id, ownerId, repeat: patternRepeat, defects, fabric, ...remnant}: SeedRemnant): SeedDocument => ({
  _id: id,
  _type: 'remnant',
  ...remnant,
  fabric: {_type: 'fabric', ...fabric},
  ...(patternRepeat
    ? {repeat: {_type: 'repeat', ...patternRepeat}}
    : {}),
  defects: defects.map(toDefect),
  owner: reference(ownerId),
  allocations: [],
})

export function requiredEnv(environment: SeedEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export function validateSeedData(): void {
  if (owners.length !== EXPECTED_COUNTS.owners || templates.length !== EXPECTED_COUNTS.templates || remnants.length !== EXPECTED_COUNTS.remnants) {
    throw new Error('Seed data does not contain the expected document counts')
  }

  const ownerIds = new Set(owners.map(({id}) => id))
  const ids = [...owners, ...templates, ...remnants].map(({id}) => id)
  if (new Set(ids).size !== ids.length) throw new Error('Seed data contains duplicate document IDs')

  for (const remnant of remnants) {
    if (!ownerIds.has(remnant.ownerId)) throw new Error('Seed data contains an invalid owner reference')
  }
}

export function buildSeedDocuments(): SeedDocument[] {
  validateSeedData()
  return [
    ...owners.map(toOwnerDocument),
    ...templates.map(toTemplateDocument),
    ...remnants.map(toRemnantDocument),
  ]
}

function isProduction(dataset: string): boolean {
  return dataset === 'production'
}

function hasExplicitOne(environment: SeedEnvironment, name: string): boolean {
  return environment[name]?.trim() === '1'
}

function assertProductionAcknowledged(dataset: string, environment: SeedEnvironment): void {
  if (isProduction(dataset) && !hasExplicitOne(environment, 'ALLOW_PRODUCTION_SEED')) {
    throw new Error(SEED_REFUSAL_PRODUCTION_ACK)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isProbeEntry(value: unknown): value is {_id: string; status?: string; allocationCount?: number} {
  if (!isRecord(value) || !isNonEmptyString(value._id)) return false
  if (value.status !== undefined && !isNonEmptyString(value.status)) return false
  if (value.allocationCount !== undefined && (typeof value.allocationCount !== 'number' || !Number.isInteger(value.allocationCount) || value.allocationCount < 0)) return false
  return true
}

export function validateLiveStateProbe(value: unknown): LiveStateProbe {
  if (!isRecord(value) || !Array.isArray(value.orders) || !Array.isArray(value.commerceRemnants)) {
    throw new Error(SEED_PROBE_INVALID)
  }

  if (!value.orders.every((entry) => isProbeEntry(entry)) || !value.commerceRemnants.every((entry) => isProbeEntry(entry))) {
    throw new Error(SEED_PROBE_INVALID)
  }

  const commerceRemnants = value.commerceRemnants
  if (!commerceRemnants.every((entry) => isNonEmptyString(entry.status) && typeof entry.allocationCount === 'number')) {
    throw new Error(SEED_PROBE_INVALID)
  }

  return {
    orders: value.orders,
    commerceRemnants: commerceRemnants as LiveStateProbe['commerceRemnants'],
  }
}

export function validateCommerceStateDocument(value: unknown): CommerceStateDocument {
  if (!isRecord(value) || value._id !== COMMERCE_STATE_DOCUMENT_ID || value._type !== COMMERCE_STATE_TYPE) {
    throw new Error(SEED_PROBE_INVALID)
  }
  if (!isNonEmptyString(value._rev) || typeof value.liveCommerce !== 'boolean') {
    throw new Error(SEED_PROBE_INVALID)
  }
  if (!isNonEmptyString(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error(SEED_PROBE_INVALID)
  }
  if (!isNonEmptyString(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error(SEED_PROBE_INVALID)
  }
  return {
    _id: COMMERCE_STATE_DOCUMENT_ID,
    _type: COMMERCE_STATE_TYPE,
    _rev: value._rev,
    liveCommerce: value.liveCommerce,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export async function readCommerceState(client: SeedReadClient): Promise<CommerceStateDocument | null> {
  let response: unknown
  try {
    response = await client.getDocument<Record<string, unknown>>(COMMERCE_STATE_DOCUMENT_ID)
  } catch {
    throw new Error(SEED_PROBE_FAILED)
  }
  if (response === null || response === undefined) return null
  return validateCommerceStateDocument(response)
}

export function hasLiveCommerceState(probe: LiveStateProbe): boolean {
  return probe.orders.length > 0 || probe.commerceRemnants.length > 0
}

function assertCommerceStateAllowed(
  commerceState: CommerceStateDocument | null,
  probe: LiveStateProbe,
  environment: SeedEnvironment,
): void {
  if ((commerceState?.liveCommerce === true || hasLiveCommerceState(probe)) && !hasExplicitOne(environment, 'ALLOW_DESTRUCTIVE_SEED')) {
    throw new Error(SEED_REFUSAL_LIVE_DATA)
  }
}

function createSeedClient(environment: SeedEnvironment): SeedClient {
  const projectId = requiredEnv(environment, 'NEXT_PUBLIC_SANITY_PROJECT_ID')
  const token = requiredEnv(environment, 'SANITY_API_WRITE_TOKEN')
  const dataset = environment.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production'

  return createClient({
    projectId,
    dataset,
    token,
    apiVersion: API_VERSION,
    useCdn: false,
  }) as unknown as SeedClient
}

export async function readLiveState(client: SeedReadClient): Promise<LiveStateProbe> {
  let response: unknown
  try {
    response = await client.fetch<unknown>(LIVE_STATE_QUERY, LIVE_STATE_PARAMS)
  } catch {
    throw new Error(SEED_PROBE_FAILED)
  }

  return validateLiveStateProbe(response)
}

export async function runSeed(options: SeedRunOptions = {}): Promise<SeedRunResult> {
  const environment = options.environment ?? process.env
  const dataset = environment.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production'
  assertProductionAcknowledged(dataset, environment)

  const documents = buildSeedDocuments()
  const client = options.client ?? createSeedClient(environment)
  const commerceState = await readCommerceState(client)
  const liveState = await readLiveState(client)
  assertCommerceStateAllowed(commerceState, liveState, environment)

  try {
    const transaction = client.transaction()
    const timestamp = new Date().toISOString()
    if (commerceState) {
      const patch: PatchOperations = {
        ifRevisionID: commerceState._rev,
        set: {liveCommerce: false, updatedAt: timestamp},
      }
      transaction.patch(COMMERCE_STATE_DOCUMENT_ID, patch)
    } else {
      transaction.create({
        _id: COMMERCE_STATE_DOCUMENT_ID,
        _type: COMMERCE_STATE_TYPE,
        liveCommerce: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
    for (const document of documents) transaction.createOrReplace(document)
    await transaction.commit()
  } catch {
    throw new Error(SEED_WRITE_FAILED)
  }

  return {dataset, documentCount: documents.length, counts: EXPECTED_COUNTS}
}

export async function main(options: SeedRunOptions = {}): Promise<SeedRunResult> {
  const result = await runSeed(options)
  console.log(`Seeded ${result.documentCount} documents: 6 owners, 5 templates, 12 remnants.`)
  return result
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1]
  return Boolean(entrypoint && pathToFileURL(entrypoint).href === import.meta.url)
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error && (
      error.message.startsWith('Missing required environment variable: ') ||
      error.message === SEED_REFUSAL_PRODUCTION_ACK ||
      error.message === SEED_REFUSAL_LIVE_DATA ||
      error.message === SEED_PROBE_FAILED ||
      error.message === SEED_PROBE_INVALID ||
      error.message === SEED_WRITE_FAILED
    )
      ? error.message
      : 'Seed failed. Check the configured Sanity environment and try again.'
    console.error(message)
    process.exitCode = 1
  })
}
