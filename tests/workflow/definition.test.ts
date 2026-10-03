import {describe, expect, it} from 'vitest'
import {evaluate, parse} from 'groq-js'

import {
  getRemnantLifecycleDefinition,
  remnantLifecycleDefinitionInput,
  WORKFLOW_DEFINITION_NAME,
} from '../../lib/workflow'

describe('remnant lifecycle definition', () => {
  it('keeps one named definition and all lifecycle stages locally valid', () => {
    const definition = getRemnantLifecycleDefinition()

    expect(definition.name).toBe(WORKFLOW_DEFINITION_NAME)
    const allocation = definition.fields?.find((field) => field.name === 'allocation')
    expect(allocation).toMatchObject({type: 'array', name: 'allocation'})
    expect(allocation?.type === 'array' ? allocation.of?.map((field) => field.name) ?? [] : []).toEqual([
      'x',
      'y',
      'w',
      'h',
    ])
    expect(definition.stages.map((stage) => stage.name)).toEqual([
      'awaiting-consent',
      'listed',
      'allocated',
      'cut',
      'sewn',
      'shipped',
      'returned',
      'sold-out',
    ])

    const actions = definition.stages.flatMap((stage) =>
      (stage.activities ?? []).flatMap((activity) => (activity.actions ?? []).map((action) => action.name)),
    )
    expect(actions).toEqual([
      'grant',
      'decline',
      'allocate',
      'abandon',
      'mark-cut',
      'mark-sewn',
      'mark-shipped',
      'return-to-listed',
      'close-sold-out',
    ])

    const listed = definition.stages.find((stage) => stage.name === 'listed')
    const guard = listed?.guards?.[0]
    expect(guard?.metadata).toHaveProperty('allocation')
    expect(guard?.metadata).not.toHaveProperty('bounds')
    expect(guard?.metadata).not.toHaveProperty('x')
    expect(guard?.metadata).not.toHaveProperty('y')
    expect(guard?.predicate).toContain('count(guard.metadata.allocation)')
    expect(guard?.predicate).toContain('document.before.allocations')
    expect(guard?.predicate).toContain('document.after.allocations')
    expect(guard?.predicate).toContain('^.document.after.allocations')

    const listedTransition = listed?.transitions?.find((transition) => transition.to === 'allocated')
    expect(listedTransition?.when).toContain('$fields.allocationUsed == false')
    const allocationActivity = listed?.activities?.find((activity) => activity.name === 'allocate')
    expect(allocationActivity?.actions?.find((action) => action.name === 'allocate')?.ops).toContainEqual({
      type: 'status.set',
      activity: 'abandon',
      status: 'skipped',
    })
    const abandonActivity = listed?.activities?.find((activity) => activity.name === 'abandon')
    expect(abandonActivity?.filter).toContain('$fields.allocationUsed == false')
    expect(abandonActivity?.actions?.find((action) => action.name === 'abandon')?.ops).toEqual(
      expect.arrayContaining([
        {
          type: 'field.set',
          target: {field: 'allocationUsed', scope: 'workflow'},
          value: {type: 'literal', value: true},
        },
        {type: 'status.set', activity: 'allocate', status: 'skipped'},
      ]),
    )

    const settlement = definition.fields?.find((field) => field.name === 'settlement')
    expect(settlement).toMatchObject({type: 'string', name: 'settlement'})

    const shipped = definition.stages.find((stage) => stage.name === 'shipped')
    const settlementActions = shipped?.activities?.flatMap((activity) => activity.actions ?? []) ?? []
    expect(settlementActions.every((action) => action.filter === undefined)).toBe(true)
    expect(settlementActions.find((action) => action.name === 'return-to-listed')?.ops).toEqual(expect.arrayContaining([
      {
        type: 'field.set',
        target: {field: 'settlement', scope: 'workflow'},
        value: {type: 'literal', value: 'listed'},
      },
      {
        type: 'field.set',
        target: {field: 'allocationUsed', scope: 'workflow'},
        value: {type: 'literal', value: true},
      },
    ]))
    expect(settlementActions.find((action) => action.name === 'close-sold-out')?.ops).toEqual(expect.arrayContaining([
      {
        type: 'field.set',
        target: {field: 'settlement', scope: 'workflow'},
        value: {type: 'literal', value: 'sold-out'},
      },
    ]))
  })

  it('requires every expected rectangle in the post-commit image', async () => {
    const definition = getRemnantLifecycleDefinition()
    const guard = definition.stages.find((stage) => stage.name === 'listed')?.guards?.[0]
    if (!guard || typeof guard.predicate !== 'string') throw new Error('allocation guard unexpectedly missing')
    const predicate = guard.predicate

    const expected = [
      {x: 0, y: 0, w: 10, h: 20},
      {x: 20, y: 0, w: 10, h: 20},
    ]
    const evaluateGuard = async (afterAllocations: unknown[], beforeAllocations: unknown[] = []) =>
      (await evaluate(parse(predicate), {
        root: {
          document: {
            before: {allocations: beforeAllocations},
            after: {_type: 'remnant', status: 'allocated', allocations: afterAllocations},
          },
          guard: {
            metadata: {
              allocation: expected,
              allocationUsed: false,
            },
          },
          mutation: {action: 'update'},
        },
      })).get()

    await expect(evaluateGuard([...expected])).resolves.toBe(true)
    await expect(
      evaluateGuard([...expected, {x: 12, y: 0, w: 6, h: 20}], [{x: 12, y: 0, w: 6, h: 20}]),
    ).resolves.toBe(true)
    await expect(evaluateGuard([...expected], [{x: 5, y: 5, w: 5, h: 5}])).resolves.toBe(false)
    await expect(evaluateGuard([expected[0], {x: 20, y: 0, w: 9, h: 20}])).resolves.toBe(false)
    await expect(evaluateGuard([...expected, {x: 40, y: 0, w: 5, h: 5}])).resolves.toBe(false)
  })

  it('keeps a reused listed instance idle when its filtered allocation activity is skipped', async () => {
    const definition = getRemnantLifecycleDefinition()
    const listed = definition.stages.find((stage) => stage.name === 'listed')
    const allocation = listed?.activities?.find((activity) => activity.name === 'allocate')
    const transition = listed?.transitions?.find((candidate) => candidate.to === 'allocated')
    if (!allocation?.filter || !transition?.when) throw new Error('listed allocation route unexpectedly incomplete')

    const params = {
      context: {mode: 'lifecycle'},
      fields: {allocationUsed: true},
      allActivitiesDone: true,
    }
    const evaluateCondition = async (condition: string) => {
      const result = await evaluate(parse(condition), {params})
      return result.get()
    }
    await expect(evaluateCondition(allocation.filter)).resolves.toBe(false)
    await expect(evaluateCondition(transition.when)).resolves.toBe(false)
  })

  it('keeps the source authoring data aligned with the deployed definition', () => {
    expect(remnantLifecycleDefinitionInput.name).toBe(WORKFLOW_DEFINITION_NAME)
    expect(remnantLifecycleDefinitionInput.stages.some((stage) => stage.name === 'shipped')).toBe(true)

    const shipped = remnantLifecycleDefinitionInput.stages.find((stage) => stage.name === 'shipped')
    expect(shipped?.transitions?.map((transition) => transition.to)).toEqual(['listed', 'sold-out'])
  })
})
