import {defineField, defineType} from 'sanity'

import {enumOptions, enumValidation, OWNER_KINDS} from './shared'

export const owner = defineType({
  name: 'owner',
  title: 'Fabric owner',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required().max(160),
    }),
    defineField({
      name: 'email',
      title: 'Email',
      type: 'string',
      validation: (Rule) => Rule.required().email(),
    }),
    defineField({
      name: 'kind',
      title: 'Owner kind',
      type: 'string',
      options: enumOptions(OWNER_KINDS),
      validation: (Rule) => enumValidation(Rule, OWNER_KINDS),
    }),
    defineField({
      name: 'shareBps',
      title: 'Share (basis points)',
      description: 'The owner share. 2,000 basis points equals 20%.',
      type: 'number',
      initialValue: 2000,
      validation: (Rule) => Rule.required().integer().min(0).max(10000),
    }),
  ],
  preview: {select: {title: 'name', subtitle: 'kind'}},
})
