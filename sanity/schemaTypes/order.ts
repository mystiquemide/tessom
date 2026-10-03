import {defineArrayMember, defineField, defineType} from 'sanity'

import {nonNegative, positive} from './shared'

export const order = defineType({
  name: 'order',
  title: 'Order',
  type: 'document',
  fields: [
    defineField({
      name: 'remnant',
      title: 'Remnant',
      type: 'reference',
      to: [{type: 'remnant'}],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'template',
      title: 'Product template',
      type: 'reference',
      to: [{type: 'productTemplate'}],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'placement',
      title: 'Placement',
      type: 'array',
      of: [defineArrayMember({type: 'placement'})],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'number',
      validation: positive,
    }),
    defineField({
      name: 'ownerShare',
      title: 'Owner share',
      type: 'number',
      validation: nonNegative,
    }),
    defineField({
      name: 'buyerContact',
      title: 'Encrypted buyer contact',
      type: 'object',
      fields: [
        defineField({
          name: 'algorithm',
          title: 'Algorithm',
          type: 'string',
          validation: (Rule) =>
            Rule.required().custom((value) => value === 'aes-256-gcm' || 'Only aes-256-gcm is supported'),
        }),
        defineField({
          name: 'version',
          title: 'Version',
          type: 'number',
          validation: (Rule) => Rule.required().integer().min(1).max(1),
        }),
        defineField({
          name: 'iv',
          title: 'Initialization vector',
          type: 'string',
          validation: (Rule) => Rule.required(),
        }),
        defineField({
          name: 'authTag',
          title: 'Authentication tag',
          type: 'string',
          validation: (Rule) => Rule.required(),
        }),
        defineField({
          name: 'ciphertext',
          title: 'Ciphertext',
          type: 'string',
          validation: (Rule) => Rule.required(),
        }),
      ],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'requestFingerprint',
      title: 'Request fingerprint',
      type: 'string',
      validation: (Rule) => Rule.required().max(128),
    }),
    defineField({
      name: 'workflowInstanceId',
      title: 'Workflow instance ID',
      type: 'string',
      validation: (Rule) => Rule.required().max(240),
    }),
    defineField({
      name: 'createdAt',
      title: 'Created at',
      type: 'datetime',
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: {subtitle: 'createdAt', remnant: 'remnant._ref'},
    prepare: ({subtitle, remnant}) => ({
      title: 'Order',
      subtitle: `${subtitle ?? 'No date'} · ${remnant ?? 'remnant pending'}`,
    }),
  },
})
