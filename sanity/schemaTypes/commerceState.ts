import {defineField, defineType} from 'sanity'

export const commerceState = defineType({
  name: 'commerceState',
  title: 'Commerce state',
  type: 'document',
  fields: [
    defineField({
      name: 'liveCommerce',
      title: 'Live commerce',
      description: 'Set once an order has been committed and allocations are live.',
      type: 'boolean',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'createdAt',
      title: 'Created at',
      type: 'datetime',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'updatedAt',
      title: 'Updated at',
      type: 'datetime',
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: {liveCommerce: 'liveCommerce', updatedAt: 'updatedAt'},
    prepare: ({liveCommerce, updatedAt}) => ({
      title: liveCommerce ? 'Live commerce' : 'Commerce seed state',
      subtitle: updatedAt ?? 'No update recorded',
    }),
  },
})
