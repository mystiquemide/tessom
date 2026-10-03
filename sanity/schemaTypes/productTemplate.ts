import {defineArrayMember, defineField, defineType} from 'sanity'

import {enumOptions, enumValidation, nonNegative, nonNegativeInteger, TEMPLATE_KINDS} from './shared'

export const productTemplate = defineType({
  name: 'productTemplate',
  title: 'Product template',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required().max(160),
    }),
    defineField({
      name: 'kind',
      title: 'Product kind',
      type: 'string',
      options: enumOptions(TEMPLATE_KINDS),
      validation: (Rule) => enumValidation(Rule, TEMPLATE_KINDS),
    }),
    defineField({
      name: 'pieces',
      title: 'Cut pieces',
      type: 'array',
      of: [defineArrayMember({type: 'templatePiece'})],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({
      name: 'seamCm',
      title: 'Seam allowance per side (cm)',
      type: 'number',
      validation: nonNegative,
    }),
    defineField({
      name: 'labourMin',
      title: 'Labour (minutes)',
      type: 'number',
      validation: nonNegativeInteger,
    }),
    defineField({
      name: 'fillCost',
      title: 'Fill and hardware cost',
      type: 'number',
      validation: nonNegative,
    }),
    defineField({
      name: 'active',
      title: 'Active',
      type: 'boolean',
      initialValue: true,
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {select: {title: 'name', subtitle: 'kind', active: 'active'}},
})
