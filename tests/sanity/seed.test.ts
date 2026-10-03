import {afterEach, describe, expect, it, vi} from 'vitest'

import {
  LIVE_STATE_PARAMS,
  LIVE_STATE_QUERY,
  SEED_PROBE_FAILED,
  SEED_PROBE_INVALID,
  SEED_REFUSAL_LIVE_DATA,
  SEED_REFUSAL_PRODUCTION_ACK,
  SEED_WRITE_FAILED,
  COMMERCE_STATE_DOCUMENT_ID,
  buildSeedDocuments,
  runSeed,
  type SeedClient,
  type SeedEnvironment,
  type SeedTransaction,
} from '../../scripts/seed'

const EMPTY_PROBE = {orders: [], commerceRemnants: []}
const EMPTY_STATE = {
  _id: COMMERCE_STATE_DOCUMENT_ID,
  _type: 'commerceState',
  _rev: 'state-rev-1',
  liveCommerce: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

function environment(overrides: Partial<Record<string, string | undefined>> = {}): SeedEnvironment {
  return {
    NEXT_PUBLIC_SANITY_PROJECT_ID: 'project-test',
    NEXT_PUBLIC_SANITY_DATASET: 'test',
    SANITY_API_WRITE_TOKEN: 'token-test',
    ...overrides,
  }
}

function fakeClient(
  probe: unknown = EMPTY_PROBE,
  commerceState: unknown = null,
  commit: () => Promise<unknown> = async () => ({transactionId: 'tx-test'}),
) {
  const operations: unknown[] = []
  const transaction: SeedTransaction = {
    create: (document) => {
      operations.push({create: document})
    },
    createOrReplace: (document) => {
      operations.push({createOrReplace: document})
    },
    patch: (documentId, patch) => {
      operations.push({patch: {id: documentId, ...patch}})
    },
    commit,
  }
  const fetch = vi.fn(async (query: string, params?: Record<string, unknown>) => {
    client.fetchCalls.push({query, params})
    return probe
  }) as unknown as SeedClient['fetch']
  const getDocument = vi.fn(async (): Promise<Record<string, unknown> | null> =>
    commerceState as Record<string, unknown> | null
  ) as unknown as SeedClient['getDocument']
  const client: SeedClient & {fetchCalls: Array<{query: string; params?: Record<string, unknown>}>; transactionCalls: number; operations: unknown[]} = {
    fetch,
    getDocument,
    transaction: vi.fn(() => {
      client.transactionCalls += 1
      return transaction
    }),
    fetchCalls: [],
    transactionCalls: 0,
    operations,
  }
  return client
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Sanity seed guard', () => {
  it('seeds a nonproduction dataset without production acknowledgement', async () => {
    const client = fakeClient()

    await expect(runSeed({environment: environment(), client})).resolves.toMatchObject({
      dataset: 'test',
      documentCount: 23,
      counts: {owners: 6, templates: 5, remnants: 12},
    })
    expect(client.transactionCalls).toBe(1)
    expect(client.operations).toHaveLength(24)
    expect(client.operations[0]).toMatchObject({
      create: {
        _id: COMMERCE_STATE_DOCUMENT_ID,
        _type: 'commerceState',
        liveCommerce: false,
      },
    })
  })

  it('refuses production without the explicit production acknowledgement', async () => {
    const client = fakeClient()

    await expect(runSeed({
      environment: environment({NEXT_PUBLIC_SANITY_DATASET: 'production'}),
      client,
    })).rejects.toThrow(SEED_REFUSAL_PRODUCTION_ACK)
    expect(client.fetch).not.toHaveBeenCalled()
    expect(client.transactionCalls).toBe(0)
  })

  it('allows an empty production dataset with the production acknowledgement', async () => {
    const client = fakeClient()

    await expect(runSeed({
      environment: environment({NEXT_PUBLIC_SANITY_DATASET: 'production', ALLOW_PRODUCTION_SEED: '1'}),
      client,
    })).resolves.toMatchObject({dataset: 'production', documentCount: 23})
    expect(client.transactionCalls).toBe(1)
  })

  it('refuses live state before opening a transaction', async () => {
    const client = fakeClient({orders: [{_id: 'order-live'}], commerceRemnants: []})

    await expect(runSeed({environment: environment(), client})).rejects.toThrow(SEED_REFUSAL_LIVE_DATA)
    expect(client.fetch).toHaveBeenCalledOnce()
    expect(client.transactionCalls).toBe(0)
    expect(client.operations).toHaveLength(0)
  })

  it('refuses the direct commerce sentinel even when the GROQ probe is empty', async () => {
    const client = fakeClient(EMPTY_PROBE, {...EMPTY_STATE, liveCommerce: true})

    await expect(runSeed({environment: environment(), client})).rejects.toThrow(SEED_REFUSAL_LIVE_DATA)
    expect(client.getDocument).toHaveBeenCalledWith(COMMERCE_STATE_DOCUMENT_ID)
    expect(client.fetch).toHaveBeenCalledOnce()
    expect(client.transactionCalls).toBe(0)
  })

  it('guards an existing sentinel revision in the seed transaction', async () => {
    const client = fakeClient(EMPTY_PROBE, EMPTY_STATE)

    await runSeed({environment: environment(), client})

    expect(client.operations[0]).toMatchObject({
      patch: {
        id: COMMERCE_STATE_DOCUMENT_ID,
        ifRevisionID: 'state-rev-1',
        set: {liveCommerce: false},
      },
    })
  })

  it('reports a concurrent sentinel revision conflict as a failed atomic seed', async () => {
    const client = fakeClient(EMPTY_PROBE, EMPTY_STATE, async () => {
      throw new Error('transaction conflict: revision mismatch')
    })

    await expect(runSeed({environment: environment(), client})).rejects.toThrow(SEED_WRITE_FAILED)
    expect(client.operations[0]).toMatchObject({patch: {ifRevisionID: 'state-rev-1'}})
  })

  it('rejects a malformed direct commerce sentinel before mutation', async () => {
    const client = fakeClient(EMPTY_PROBE, {_id: COMMERCE_STATE_DOCUMENT_ID, liveCommerce: 'true'})

    await expect(runSeed({environment: environment(), client})).rejects.toThrow(SEED_PROBE_INVALID)
    expect(client.transactionCalls).toBe(0)
  })

  it('allows live state only with the explicit destructive override', async () => {
    const client = fakeClient({
      orders: [],
      commerceRemnants: [{_id: 'remnant-live', status: 'allocated', allocationCount: 1}],
    })

    await expect(runSeed({environment: environment({ALLOW_DESTRUCTIVE_SEED: '1'}), client})).resolves.toMatchObject({documentCount: 23})
    expect(client.transactionCalls).toBe(1)
    expect(client.operations).toHaveLength(24)
  })

  it('resets a live sentinel only with the destructive override', async () => {
    const client = fakeClient(EMPTY_PROBE, {...EMPTY_STATE, liveCommerce: true})

    await expect(runSeed({environment: environment({ALLOW_DESTRUCTIVE_SEED: '1'}), client})).resolves.toMatchObject({documentCount: 23})
    expect(client.operations[0]).toMatchObject({
      patch: {
        id: COMMERCE_STATE_DOCUMENT_ID,
        ifRevisionID: 'state-rev-1',
        set: {liveCommerce: false},
      },
    })
  })

  it('rejects malformed preflight responses before mutation', async () => {
    const client = fakeClient({orders: 'not-an-array', commerceRemnants: []})

    await expect(runSeed({environment: environment(), client})).rejects.toThrow(SEED_PROBE_INVALID)
    expect(client.transactionCalls).toBe(0)
  })

  it('sanitizes remote probe errors', async () => {
    const client = fakeClient()
    client.fetch = vi.fn(async () => {
      throw new Error('https://private.example.test?token=secret buyerEmail=buyer@example.com')
    }) as unknown as SeedClient['fetch']

    const failure = await runSeed({environment: environment(), client}).catch((error: unknown) => error)
    expect(failure).toEqual(new Error(SEED_PROBE_FAILED))
    expect(String(failure)).not.toContain('private.example.test')
    expect(String(failure)).not.toContain('secret')
    expect(String(failure)).not.toContain('buyer@example.com')
  })

  it('sanitizes remote transaction errors', async () => {
    const client = fakeClient(EMPTY_PROBE, null, async () => {
      throw new Error('https://private.example.test/write token=secret buyerEmail=buyer@example.com')
    })

    const failure = await runSeed({environment: environment(), client}).catch((error: unknown) => error)
    expect(failure).toEqual(new Error(SEED_WRITE_FAILED))
    expect(String(failure)).not.toContain('private.example.test')
    expect(String(failure)).not.toContain('secret')
    expect(String(failure)).not.toContain('buyer@example.com')
  })

  it('uses parameterized preflight GROQ and preserves stable references', async () => {
    const client = fakeClient()

    await runSeed({environment: environment(), client})

    expect(client.fetchCalls[0]).toEqual({query: LIVE_STATE_QUERY, params: LIVE_STATE_PARAMS})
    expect(LIVE_STATE_QUERY).toContain('$orderType')
    expect(LIVE_STATE_QUERY).toContain('$remnantType')
    expect(LIVE_STATE_QUERY).toContain('$commerceStatuses')

    const documents = buildSeedDocuments()
    const remnants = documents.filter((document) => document._type === 'remnant')
    expect(remnants).toHaveLength(12)
    expect(remnants.every((document) => (document.owner as {_ref?: string})._ref?.startsWith('owner-'))).toBe(true)
  })
})
