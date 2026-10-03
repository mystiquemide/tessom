import {describe, expect, it, vi} from 'vitest'

import {
  abandonLifecycleAllocation,
  abandonPreparedLifecycleAllocation,
  consentInstanceId,
  createWorkflowEngine,
  finalizeLifecycleAllocation,
  fireWorkflowAction,
  isWorkflowTag,
  lifecycleInstanceId,
  prepareLifecycleAllocation,
  readWorkflowConfig,
  startConsentInstance,
  startLifecycleInstance,
  UnusableLifecycleInstanceError,
  type WorkflowEnginePort,
} from '../../lib/workflow'
import type {OperationResult, WorkflowInstance} from '@sanity/workflow-engine'

describe('workflow environment mapping', () => {
  it('accepts only the isolated Tessom tags', () => {
    expect(isWorkflowTag('tessom-dev')).toBe(true)
    expect(isWorkflowTag('tessom-prod')).toBe(true)
    expect(isWorkflowTag('production')).toBe(false)
  })

  it('fails closed when project or write token configuration is absent', () => {
    expect(
      readWorkflowConfig({
        NEXT_PUBLIC_SANITY_PROJECT_ID: 'project',
        NEXT_PUBLIC_SANITY_DATASET: 'production',
      }),
    ).toBeUndefined()
    expect(
      createWorkflowEngine({
        env: {
          NEXT_PUBLIC_SANITY_PROJECT_ID: 'project',
          SANITY_API_WRITE_TOKEN: 'secret-is-not-logged',
          WORKFLOW_TAG: 'wrong-tag',
        },
      }),
    ).toBeUndefined()
  })

  it('maps a complete environment to the workflow resource without exposing the token', () => {
    expect(
      readWorkflowConfig({
        NEXT_PUBLIC_SANITY_PROJECT_ID: 'project',
        NEXT_PUBLIC_SANITY_DATASET: 'production',
        SANITY_API_WRITE_TOKEN: 'token',
        WORKFLOW_TAG: 'tessom-prod',
      }),
    ).toEqual({
      projectId: 'project',
      dataset: 'production',
      token: 'token',
      tag: 'tessom-prod',
      workflowResource: {type: 'dataset', id: 'project.production'},
    })
  })
})

describe('workflow instance identity', () => {
  it('keeps readable deterministic IDs distinct for punctuation variants and within the ID limit', () => {
    const dotted = consentInstanceId('a.b', 'tessom-dev')
    const dashed = consentInstanceId('a-b', 'tessom-dev')
    const long = lifecycleInstanceId('order-' + 'x'.repeat(400), 'tessom-prod')

    expect(dotted).not.toBe(dashed)
    expect(dotted).toContain('a.b')
    expect(consentInstanceId('remnant-1', 'tessom-dev')).toBe('tessom-tessom-dev-consent-remnant-1')
    expect(dotted).toBe(consentInstanceId('a.b', 'tessom-dev'))
    expect(long.length).toBeLessThanOrEqual(128)
    expect(long).toContain('order-')
  })
})

describe('workflow wrappers', () => {
  it('passes a consent start through the injected engine with a dataset GDR', async () => {
    const startInstance = vi.fn(async (args: Parameters<WorkflowEnginePort['startInstance']>[0]) => {
      expect(args.definition).toBe('remnant-lifecycle')
      expect(args.context).toEqual({mode: 'consent'})
      expect(args.initialFields?.[0]).toMatchObject({type: 'subject', name: 'subject'})
      throw new Error('stop after inspecting the call')
    })
    const engine = fakeEngine({startInstance})

    await expect(startConsentInstance('remnant-1', {engine})).rejects.toThrow('stop after inspecting the call')
    expect(startInstance).toHaveBeenCalledOnce()
  })

  it('forwards action identity and idempotency through the action seam', async () => {
    const fireAction = vi.fn(async (args: Parameters<WorkflowEnginePort['fireAction']>[0]) => {
      expect(args).toMatchObject({
        instanceId: 'instance-1',
        activity: 'allocate',
        action: 'allocate',
        idempotencyKey: 'request-1',
      })
      throw new Error('stop after inspecting the call')
    })
    const engine = fakeEngine({fireAction})

    await expect(
      fireWorkflowAction(
        {
          instanceId: 'instance-1',
          activity: 'allocate',
          action: 'allocate',
          idempotencyKey: 'request-1',
        },
        {engine},
      ),
    ).rejects.toThrow('stop after inspecting the call')
    expect(fireAction).toHaveBeenCalledOnce()
  })

  it('initializes every placement rectangle for a multi-piece order', async () => {
    const startInstance = vi.fn(async (args: Parameters<WorkflowEnginePort['startInstance']>[0]) => {
      const allocation = args.initialFields?.find((field) => field.name === 'allocation')
      expect(allocation).toMatchObject({
        type: 'array',
        value: [
          {x: 0, y: 0, w: 20, h: 20},
          {x: 20, y: 0, w: 20, h: 20},
          {x: 0, y: 20, w: 40, h: 10},
        ],
      })
      return successfulOperation
    })
    const engine = fakeEngine({startInstance})

    const result = await startLifecycleInstance('remnant-1', {
      engine,
      orderId: 'order-1',
      allocation: [
        {x: 0, y: 0, w: 20, h: 20},
        {x: 20, y: 0, w: 20, h: 20},
        {x: 0, y: 20, w: 40, h: 10},
      ],
    })

    expect(result).toBe(successfulOperation)
    expect(startInstance).toHaveBeenCalledOnce()
  })

  it('idempotently abandons a prepared allocation through the listed activity', async () => {
    const fireAction = vi.fn(async (args: Parameters<WorkflowEnginePort['fireAction']>[0]) => {
      expect(args).toMatchObject({
        instanceId: 'instance-1',
        activity: 'abandon',
        action: 'abandon',
        idempotencyKey: 'instance-1:abandon',
        idempotent: true,
      })
      throw new Error('stop after inspecting the call')
    })
    const engine = fakeEngine({fireAction})
    const prepared = {engine, instanceId: 'instance-1', started: successfulOperation}

    await expect(abandonPreparedLifecycleAllocation(prepared)).rejects.toThrow('stop after inspecting the call')
    expect(fireAction).toHaveBeenCalledOnce()
  })

  it('abandons a lifecycle instance directly by ID with a stable idempotency key', async () => {
    const fireAction = vi.fn(async (args: Parameters<WorkflowEnginePort['fireAction']>[0]) => {
      expect(args).toEqual({
        instanceId: 'instance-1',
        activity: 'abandon',
        action: 'abandon',
        idempotencyKey: 'instance-1:abandon',
        idempotent: true,
      })
      return abandonedOperation
    })
    const engine = fakeEngine({fireAction})

    await expect(abandonLifecycleAllocation('instance-1', {engine})).resolves.toBe(abandonedOperation)
    expect(fireAction).toHaveBeenCalledOnce()
  })

  it('fails closed when directly abandoning an empty lifecycle instance ID', async () => {
    const fireAction = vi.fn(async () => abandonedOperation)
    const engine = fakeEngine({fireAction})

    await expect(abandonLifecycleAllocation('   ', {engine})).resolves.toBeUndefined()
    expect(fireAction).not.toHaveBeenCalled()
  })

  it('preserves the ID when a started lifecycle instance is unusable', async () => {
    const engine = fakeEngine({startInstance: vi.fn(async () => abandonedOperation)})

    const failure = prepareLifecycleAllocation('remnant-1', {
      engine,
      orderId: 'order-1',
      allocation: [{x: 0, y: 0, w: 20, h: 20}],
    })

    await expect(failure).rejects.toBeInstanceOf(UnusableLifecycleInstanceError)
    await expect(failure).rejects.toMatchObject({instanceId: 'tessom-tessom-dev-order-order-1'})
  })

  it('prepares before commit, finalizes after commit, and exposes an orphan on commit failure', async () => {
    const events: string[] = []
    const engine = fakeEngine({
      startInstance: vi.fn(async () => {
        events.push('start')
        return successfulOperation
      }),
      fireAction: vi.fn(async (args: Parameters<WorkflowEnginePort['fireAction']>[0]) => {
        events.push('allocate')
        expect(args.idempotencyKey).toBe('order-1-allocation')
        return successfulOperation
      }),
      tick: vi.fn(async () => {
        events.push('tick')
        return successfulOperation
      }),
    })

    const prepared = await prepareLifecycleAllocation('remnant-1', {
      engine,
      orderId: 'order-1',
      allocation: [{x: 0, y: 0, w: 20, h: 20}],
      idempotencyKey: 'order-1-allocation',
    })
    expect(prepared?.instanceId).toContain('order-1')
    if (!prepared) throw new Error('lifecycle preparation unexpectedly unavailable')

    const retried = await prepareLifecycleAllocation('remnant-1', {
      engine,
      orderId: 'order-1',
      allocation: [{x: 0, y: 0, w: 20, h: 20}],
      idempotencyKey: 'order-1-allocation',
    })
    expect(retried?.instanceId).toBe(prepared.instanceId)

    const outcome = await finalizeLifecycleAllocation(
      prepared,
      async () => {
        events.push('commit')
        return 'committed'
      },
    )
    expect(outcome).toMatchObject({committed: true, value: 'committed'})
    expect(events).toEqual(['start', 'start', 'commit', 'allocate', 'tick'])

    const failed = await finalizeLifecycleAllocation(prepared, async () => {
      events.push('failed-commit')
      throw new Error('transaction failed')
    })
    expect(failed).toMatchObject({committed: false, orphanedInstanceId: prepared?.instanceId})
    expect(events).toEqual(['start', 'start', 'commit', 'allocate', 'tick', 'failed-commit'])
  })

  it('rejects a same-key preparation after the listed instance was abandoned', async () => {
    let abandoned = false
    const engine = fakeEngine({
      startInstance: vi.fn(async () => (abandoned ? abandonedOperation : successfulOperation)),
      fireAction: vi.fn(async () => {
        abandoned = true
        return abandonedOperation
      }),
    })

    const prepared = await prepareLifecycleAllocation('remnant-1', {
      engine,
      orderId: 'order-1',
      allocation: [{x: 0, y: 0, w: 20, h: 20}],
      idempotencyKey: 'order-1-allocation',
    })
    if (!prepared) throw new Error('lifecycle preparation unexpectedly unavailable')

    await expect(abandonPreparedLifecycleAllocation(prepared)).resolves.toBe(abandonedOperation)
    const resumed = prepareLifecycleAllocation('remnant-1', {
      engine,
      orderId: 'order-1',
      allocation: [{x: 0, y: 0, w: 20, h: 20}],
      idempotencyKey: 'order-1-allocation',
    })
    await expect(resumed).rejects.toBeInstanceOf(UnusableLifecycleInstanceError)
    await expect(resumed).rejects.toMatchObject({instanceId: prepared.instanceId})
    expect(engine.startInstance).toHaveBeenCalledTimes(2)
  })
})

const successfulInstance = {
  _id: 'instance-1',
  _type: 'sanity.workflow.instance',
  _rev: 'rev-1',
  _createdAt: '2026-10-02T00:00:00.000Z',
  _updatedAt: '2026-10-02T00:00:00.000Z',
  tag: 'tessom-dev',
  workflowResource: {type: 'dataset', id: 'project.production'},
  definition: 'remnant-lifecycle',
  pinnedVersion: 1,
  definitionSnapshot: '{}',
  fields: [
    {
      _key: 'subject',
      _type: 'subject',
      name: 'subject',
      value: {id: 'dataset:project:production:remnant-1', type: 'remnant'},
      types: ['remnant'],
    },
    {
      _key: 'order',
      _type: 'doc.ref',
      name: 'order',
      value: {id: 'dataset:project:production:order-1', type: 'order'},
      types: ['order'],
    },
    {
      _key: 'allocation',
      _type: 'array',
      name: 'allocation',
      value: [{x: 0, y: 0, w: 20, h: 20}],
      of: [
        {type: 'number', name: 'x', title: 'X'},
        {type: 'number', name: 'y', title: 'Y'},
        {type: 'number', name: 'w', title: 'Width'},
        {type: 'number', name: 'h', title: 'Height'},
      ],
    },
    {
      _key: 'allocationUsed',
      _type: 'boolean',
      name: 'allocationUsed',
      value: false,
    },
  ],
  context: [],
  ancestors: [],
  currentStage: 'listed',
  stages: [
    {
      _key: 'listed',
      name: 'listed',
      enteredAt: '2026-10-02T00:00:00.000Z',
      fields: [],
      activities: [],
    },
  ],
  pendingEffects: [],
  effectHistory: [],
  history: [],
  startedAt: '2026-10-02T00:00:00.000Z',
  lastChangedAt: '2026-10-02T00:00:00.000Z',
} satisfies WorkflowInstance

const successfulOperation = {
  instance: successfulInstance,
  cascaded: 0,
  changed: true,
} satisfies OperationResult

const abandonedOperation = {
  ...successfulOperation,
  instance: {
    ...successfulInstance,
    fields: successfulInstance.fields.map((field) =>
      field.name === 'allocationUsed' && field._type === 'boolean' ? {...field, value: true} : field,
    ),
  },
} satisfies OperationResult

function fakeEngine(overrides: Partial<WorkflowEnginePort> = {}): WorkflowEnginePort {
  return {
    tag: 'tessom-dev',
    workflowResource: {type: 'dataset', id: 'project.production'},
    deployDefinitions: async () => {
      throw new Error('not used')
    },
    startInstance: async () => {
      throw new Error('not used')
    },
    fireAction: async () => {
      throw new Error('not used')
    },
    tick: async () => {
      throw new Error('not used')
    },
    ...overrides,
  }
}
