import type {RemnantLifecycleAuthoringInput} from './engine'

/**
 * Authoring data for Tessom's one workflow definition.
 *
 * The engine wrapper validates this object with `defineWorkflow` before it is
 * used or deployed. Keeping the authoring data here makes the lifecycle easy
 * to inspect in tests without spreading engine calls through the app.
 */

export const remnantLifecycleDefinitionInput = {
  name: 'remnant-lifecycle',
  title: 'Tessom remnant lifecycle',
  description: 'Owner consent, allocation, production, and safe remnant reuse.',
  initialStage: 'awaiting-consent',
  fields: [
    {
      type: 'subject',
      name: 'subject',
      title: 'Remnant',
      types: ['remnant'],
      initialValue: {type: 'input'},
    },
    {
      type: 'doc.ref',
      name: 'order',
      title: 'Order',
      types: ['order'],
      initialValue: {type: 'input'},
    },
    {
      type: 'array',
      name: 'allocation',
      title: 'Allocated areas',
      initialValue: {type: 'input'},
      of: [
        {type: 'number', name: 'x', title: 'X'},
        {type: 'number', name: 'y', title: 'Y'},
        {type: 'number', name: 'w', title: 'Width'},
        {type: 'number', name: 'h', title: 'Height'},
      ],
    },
    {
      type: 'string',
      name: 'settlement',
      title: 'Shipping settlement',
      initialValue: {type: 'input'},
    },
    {
      type: 'boolean',
      name: 'allocationUsed',
      title: 'Allocation has been committed',
      initialValue: {type: 'literal', value: false},
    },
    {
      type: 'string',
      name: 'consent',
      title: 'Owner consent',
    },
  ],
  stages: [
    {
      name: 'awaiting-consent',
      title: 'Awaiting consent',
      activities: [
        {
          name: 'consent',
          title: 'Owner consent',
          filter: '$context.mode == "consent"',
          actions: [
            {
              name: 'grant',
              title: 'Grant consent',
              semantics: ['decision.accept'],
              status: 'done',
              ops: [
                {
                  type: 'field.set',
                  target: {field: 'consent'},
                  value: {type: 'literal', value: 'granted'},
                },
              ],
            },
            {
              name: 'decline',
              title: 'Decline consent',
              semantics: ['decision.decline'],
              status: 'done',
              ops: [
                {
                  type: 'field.set',
                  target: {field: 'consent'},
                  value: {type: 'literal', value: 'declined'},
                },
              ],
            },
          ],
        },
      ],
      transitions: [
        {
          name: 'start-lifecycle',
          title: 'Start order lifecycle',
          to: 'listed',
          when: '$context.mode == "lifecycle"',
        },
        {
          name: 'grant-consent',
          title: 'List remnant',
          to: 'listed',
          when: '$fields.consent == "granted"',
        },
        {
          name: 'decline-consent',
          title: 'Return remnant',
          to: 'returned',
          when: '$fields.consent == "declined"',
        },
      ],
    },
    {
      name: 'listed',
      title: 'Listed',
      description:
        'Consent instances stay here. An order instance can allocate once; a reused instance stays listed for safety.',
      guards: [
        {
          name: 'allocation-lock',
          title: 'Protect allocated remnant area',
          description: 'Only one guarded allocation set may be added to this remnant area.',
          match: {
            types: ['remnant'],
            actions: ['update'],
            idRefs: [{type: 'fieldRead', field: 'subject'}],
          },
          metadata: {
            allocation: {type: 'fieldRead', field: 'allocation'},
            allocationUsed: {type: 'fieldRead', field: 'allocationUsed'},
          },
          // The empty allocation metadata on a consent instance leaves normal
          // remnant edits alone. An order instance must add the complete set of
          // expected areas in one revision-guarded transaction. The pairwise
          // overlap check rejects prior allocations intersecting any requested
          // rectangle, while the order persistence validator rejects precise
          // rectangle and sibling overlap before this transaction is sent.
          predicate:
            '!defined(guard.metadata.allocation) || count(guard.metadata.allocation) == 0 || guard.metadata.allocationUsed == true || (' +
            'defined(document.before) && defined(document.after) && ' +
            'document.after._type == "remnant" && ' +
            'document.after.status == "allocated" && ' +
            'count(coalesce(document.after.allocations, [])) == count(coalesce(document.before.allocations, [])) + count(guard.metadata.allocation) && ' +
            'count(guard.metadata.allocation[count(^.document.after.allocations[ @.x == ^.x && @.y == ^.y && @.w == ^.w && @.h == ^.h]) > 0]) == count(guard.metadata.allocation) && ' +
            'count(guard.metadata.allocation[count(coalesce(^.document.before.allocations, [])[ @.x < ^.x + ^.w && @.x + @.w > ^.x && @.y < ^.y + ^.h && @.y + @.h > ^.y]) > 0]) == 0' +
            ')',
        },
      ],
      activities: [
        {
          name: 'allocate',
          title: 'Allocate remnant area',
          filter: '$context.mode == "lifecycle" && $fields.allocationUsed == false',
          requirements: [
            {
              name: 'allocation-committed',
              title: 'The remnant allocation is committed',
              type: 'groq',
              query:
                '$fields.subject.status == "allocated" && defined($fields.order) && count($fields.allocation) > 0 && count($fields.allocation[count($fields.subject.allocations[ @.x == ^.x && @.y == ^.y && @.w == ^.w && @.h == ^.h]) > 0]) == count($fields.allocation)',
            },
          ],
          actions: [
            {
              name: 'allocate',
              title: 'Allocate',
              status: 'done',
              ops: [
                {
                  type: 'status.set',
                  activity: 'abandon',
                  status: 'skipped',
                },
              ],
            },
          ],
        },
        {
          name: 'abandon',
          title: 'Abandon prepared allocation',
          filter: '$context.mode == "lifecycle" && $fields.allocationUsed == false',
          actions: [
            {
              name: 'abandon',
              title: 'Abandon',
              status: 'done',
              ops: [
                {
                  type: 'field.set',
                  target: {field: 'allocationUsed'},
                  value: {type: 'literal', value: true},
                },
                {
                  type: 'status.set',
                  activity: 'allocate',
                  status: 'skipped',
                },
              ],
            },
          ],
        },
      ],
      transitions: [
        {
          name: 'allocated',
          title: 'Begin production',
          to: 'allocated',
          when: '$context.mode == "lifecycle" && $fields.allocationUsed == false && $allActivitiesDone',
        },
      ],
    },
    {
      name: 'allocated',
      title: 'Allocated',
      activities: [
        {
          name: 'cut',
          title: 'Cut pieces',
          filter: '$context.mode == "lifecycle"',
          actions: [{name: 'mark-cut', title: 'Mark cut', status: 'done'}],
        },
      ],
      transitions: [
        {name: 'cut', title: 'Pieces cut', to: 'cut', when: '$allActivitiesDone'},
      ],
    },
    {
      name: 'cut',
      title: 'Cut',
      activities: [
        {
          name: 'sew',
          title: 'Sew pieces',
          filter: '$context.mode == "lifecycle"',
          actions: [{name: 'mark-sewn', title: 'Mark sewn', status: 'done'}],
        },
      ],
      transitions: [
        {name: 'sewn', title: 'Pieces sewn', to: 'sewn', when: '$allActivitiesDone'},
      ],
    },
    {
      name: 'sewn',
      title: 'Sewn',
      activities: [
        {
          name: 'ship',
          title: 'Ship order',
          filter: '$context.mode == "lifecycle"',
          actions: [{name: 'mark-shipped', title: 'Mark shipped', status: 'done'}],
        },
      ],
      transitions: [
        {name: 'shipped', title: 'Order shipped', to: 'shipped', when: '$allActivitiesDone'},
      ],
    },
    {
      name: 'shipped',
      title: 'Shipped',
      description:
        'A server-authoritative settlement action chooses listed or sold-out. The stage stays here until that decision is made.',
      activities: [
        {
          name: 'settle',
          title: 'Settle remnant availability',
          filter: '$context.mode == "lifecycle"',
          actions: [
            {
              name: 'return-to-listed',
              title: 'Return to listed',
              status: 'done',
              ops: [
                {
                  type: 'field.set',
                  target: {field: 'settlement'},
                  value: {type: 'literal', value: 'listed'},
                },
                {
                  type: 'field.set',
                  target: {field: 'allocationUsed'},
                  value: {type: 'literal', value: true},
                },
              ],
            },
            {
              name: 'close-sold-out',
              title: 'Close as sold out',
              status: 'done',
              ops: [
                {
                  type: 'field.set',
                  target: {field: 'settlement'},
                  value: {type: 'literal', value: 'sold-out'},
                },
              ],
            },
          ],
        },
      ],
      transitions: [
        {
          name: 'reuse-remnant',
          title: 'Return to listed',
          to: 'listed',
          when: '$fields.settlement == "listed" && $allActivitiesDone',
        },
        {
          name: 'sold-out',
          title: 'Mark sold out',
          to: 'sold-out',
          when: '$fields.settlement == "sold-out" && $allActivitiesDone',
        },
      ],
    },
    {name: 'returned', title: 'Returned'},
    {name: 'sold-out', title: 'Sold out'},
  ],
} satisfies RemnantLifecycleAuthoringInput

export type RemnantLifecycleDefinitionInput = typeof remnantLifecycleDefinitionInput
