import {describe, expect, it, vi} from 'vitest'

import {
  bootstrapConsentWorkflows,
  CONSENT_INSTANCE_IDS_QUERY,
  REMNANT_IDS_QUERY,
  runBootstrapCli,
} from '../../scripts/bootstrap-workflows'
import {consentInstanceId, WORKFLOW_DEFINITION_NAME} from '../../lib/workflow'
import type {SanityReadClient} from '../../lib/sanity/client'
import type {OperationResult, WorkflowInstance} from '@sanity/workflow-engine'

const env = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: 'project',
  NEXT_PUBLIC_SANITY_DATASET: 'production',
  SANITY_API_WRITE_TOKEN: 'test-token',
  WORKFLOW_TAG: 'tessom-dev',
} as const

function operation(instanceId: string, currentStage = 'awaiting-consent'): OperationResult {
  const instance = {
    _id: instanceId,
    _type: 'sanity.workflow.instance',
    tag: 'tessom-dev',
    definition: WORKFLOW_DEFINITION_NAME,
    currentStage,
  } as WorkflowInstance
  return {instance, changed: true, cascaded: 0}
}

function client(remnants: unknown, existing: unknown): SanityReadClient & {calls: Array<{query: string; params?: Record<string, unknown>}>} {
  const calls: Array<{query: string; params?: Record<string, unknown>}> = []
  const fetch = async <T>(query: string, params?: Record<string, unknown>): Promise<T> => {
    calls.push({query, params})
    return (query === REMNANT_IDS_QUERY ? remnants : existing) as T
  }
  return {
    calls,
    fetch: vi.fn(fetch) as SanityReadClient['fetch'],
  }
}

describe('consent workflow bootstrap', () => {
  it('handles empty remnant and instance projections without starting anything', async () => {
    const sanityClient = client([], [])
    const start = vi.fn(async () => operation('unused'))

    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start})).resolves.toEqual({
      created: 0,
      skipped: 0,
    })
    expect(start).not.toHaveBeenCalled()
    expect(sanityClient.calls).toHaveLength(2)
  })

  it('uses parameterized projections and starts only missing consent instances', async () => {
    const sanityClient = client(
      [{_id: 'remnant-1', status: 'intake'}, {_id: 'remnant-2', status: 'intake'}, {_id: 'remnant-3', status: 'intake'}],
      [{_id: consentInstanceId('remnant-2', 'tessom-dev'), currentStage: 'awaiting-consent'}],
    )
    const start = vi.fn(async (remnantId: string, options: {instanceId?: string}) => operation(options.instanceId ?? remnantId))

    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start})).resolves.toEqual({
      created: 2,
      skipped: 1,
    })
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls.map(([id]) => id)).toEqual(['remnant-1', 'remnant-3'])
    expect(start.mock.calls.map(([, options]) => options.instanceId)).toEqual([
      consentInstanceId('remnant-1', 'tessom-dev'),
      consentInstanceId('remnant-3', 'tessom-dev'),
    ])
    expect(sanityClient.calls[0]).toEqual({
      query: REMNANT_IDS_QUERY,
      params: {remnantType: 'remnant'},
    })
    expect(sanityClient.calls[1]).toEqual({
      query: CONSENT_INSTANCE_IDS_QUERY,
      params: {
        workflowInstanceType: 'sanity.workflow.instance',
        workflowTag: 'tessom-dev',
        workflowDefinition: WORKFLOW_DEFINITION_NAME,
        consentInstancePattern: 'tessom-tessom-dev-consent-*',
      },
    })
    expect(CONSENT_INSTANCE_IDS_QUERY).not.toContain('tessom-dev')
    expect(REMNANT_IDS_QUERY).toContain('status')
    expect(CONSENT_INSTANCE_IDS_QUERY).toContain('currentStage')
  })

  it('is idempotent when the second read includes the instances created by the first run', async () => {
    const createdIds = [consentInstanceId('remnant-1', 'tessom-dev'), consentInstanceId('remnant-2', 'tessom-dev')]
    const sanityClient: SanityReadClient = {
      fetch: vi
        .fn()
        .mockResolvedValueOnce([{_id: 'remnant-1', status: 'intake'}, {_id: 'remnant-2', status: 'intake'}])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{_id: 'remnant-1', status: 'intake'}, {_id: 'remnant-2', status: 'intake'}])
        .mockResolvedValueOnce(createdIds.map((_id) => ({_id, currentStage: 'awaiting-consent'}))),
    }
    const start = vi.fn(async (remnantId: string, options: {instanceId?: string}) => operation(options.instanceId ?? remnantId))

    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start})).resolves.toEqual({
      created: 2,
      skipped: 0,
    })
    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start})).resolves.toEqual({
      created: 0,
      skipped: 2,
    })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('aligns mixed seeded statuses and skips already aligned instances', async () => {
    const listedId = consentInstanceId('listed', 'tessom-dev')
    const returnedId = consentInstanceId('returned', 'tessom-dev')
    const awaitingId = consentInstanceId('awaiting', 'tessom-dev')
    const sanityClient = client(
      [
        {_id: 'intake', status: 'intake'},
        {_id: 'listed', status: 'listed'},
        {_id: 'returned', status: 'returned'},
        {_id: 'awaiting', status: 'consented'},
      ],
      [
        {_id: listedId, currentStage: 'awaiting-consent'},
        {_id: returnedId, currentStage: 'awaiting-consent'},
        {_id: awaitingId, currentStage: 'awaiting-consent'},
      ],
    )
    const start = vi.fn(async (remnantId: string, options: {instanceId?: string}) => operation(options.instanceId ?? remnantId))
    const grant = vi.fn(async (instanceId: string) => operation(instanceId, 'listed'))
    const decline = vi.fn(async (instanceId: string) => operation(instanceId, 'returned'))
    const tick = vi.fn(async (instanceId: string) => operation(instanceId, instanceId === returnedId ? 'returned' : 'listed'))

    await expect(
      bootstrapConsentWorkflows({
        env,
        sanityClient,
        startConsentInstance: start,
        grantConsent: grant,
        declineConsent: decline,
        tickWorkflowInstance: tick,
      }),
    ).resolves.toEqual({created: 1, skipped: 1})
    expect(start).toHaveBeenCalledWith('intake', expect.objectContaining({instanceId: consentInstanceId('intake', 'tessom-dev')}))
    expect(grant).toHaveBeenCalledWith(listedId, expect.objectContaining({idempotent: true}))
    expect(decline).toHaveBeenCalledWith(returnedId, expect.objectContaining({idempotent: true}))
    expect(tick).toHaveBeenCalledTimes(2)
    expect(grant).not.toHaveBeenCalledWith(awaitingId, expect.anything())
  })

  it('rejects malformed Sanity projections before starting a workflow', async () => {
    const sanityClient = client([{_id: 'remnant-1', status: 'intake'}, {_id: 4, status: 'intake'}], [])
    const start = vi.fn(async () => operation('unused'))

    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start})).rejects.toThrow(
      'Invalid Sanity value',
    )
    expect(start).not.toHaveBeenCalled()
  })

  it('rejects malformed consent stages before starting or firing actions', async () => {
    const sanityClient = client(
      [{_id: 'remnant-1', status: 'listed'}],
      [{_id: consentInstanceId('remnant-1', 'tessom-dev'), currentStage: 'bogus'}],
    )
    const start = vi.fn(async () => operation('unused'))
    const grant = vi.fn(async () => operation('unused', 'listed'))

    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start, grantConsent: grant})).rejects.toThrow(
      'Invalid Sanity value',
    )
    expect(start).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
  })

  it('fails when the workflow operation is missing and never counts it as created', async () => {
    const sanityClient = client([{_id: 'remnant-1', status: 'intake'}], [])
    const start = vi.fn(async () => undefined)

    await expect(bootstrapConsentWorkflows({env, sanityClient, startConsentInstance: start})).rejects.toThrow(
      'Consent workflow operation failed',
    )
  })

  it('returns no result and performs no reads when server configuration is missing', async () => {
    const sanityClient = client([], [])
    const start = vi.fn(async () => operation('unused'))

    await expect(
      bootstrapConsentWorkflows({
        env: {NEXT_PUBLIC_SANITY_PROJECT_ID: 'project', NEXT_PUBLIC_SANITY_DATASET: 'production'},
        sanityClient,
        startConsentInstance: start,
      }),
    ).resolves.toBeUndefined()
    expect(sanityClient.fetch).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it('sanitizes CLI failure output', async () => {
    const errorText = 'token super-secret should never be printed'
    const sanityClient = client([{_id: 'remnant-1', status: 'intake'}], [])
    const start = vi.fn(async () => {
      throw new Error(errorText)
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(runBootstrapCli({env, sanityClient, startConsentInstance: start})).resolves.toBe(false)
    expect(error).toHaveBeenCalledWith(
      'Workflow bootstrap failed. Check the Sanity project, dataset, token, and workflow deployment.',
    )
    expect(error.mock.calls.flat().join(' ')).not.toContain('super-secret')
    error.mockRestore()
  })
})
