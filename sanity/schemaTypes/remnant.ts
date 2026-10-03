import {defineArrayMember, defineField, defineType} from 'sanity'

import {enumOptions, enumValidation, positive, REMNANT_STATUSES} from './shared'

export const remnant = defineType({
  name: 'remnant',
  title: 'Fabric remnant',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required().max(160),
    }),
    defineField({
      name: 'fabric',
      title: 'Fabric',
      type: 'fabric',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'widthCm',
      title: 'Width (cm)',
      type: 'number',
      validation: positive,
    }),
    defineField({
      name: 'heightCm',
      title: 'Height (cm)',
      type: 'number',
      validation: positive,
    }),
    defineField({
      name: 'repeat',
      title: 'Pattern repeat',
      type: 'repeat',
    }),
    defineField({
      name: 'directional',
      title: 'Directional fabric',
      description: 'When true, the offer engine must preserve the nap direction.',
      type: 'boolean',
      initialValue: false,
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'defects',
      title: 'Defects',
      type: 'array',
      of: [defineArrayMember({type: 'defect'})],
      initialValue: [],
    }),
    defineField({
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: {hotspot: true},
    }),
    defineField({
      name: 'owner',
      title: 'Owner',
      type: 'reference',
      to: [{type: 'owner'}],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: enumOptions(REMNANT_STATUSES),
      initialValue: 'intake',
      validation: (Rule) => enumValidation(Rule, REMNANT_STATUSES),
    }),
    defineField({
      name: 'allocations',
      title: 'Allocations',
      description: 'Locked rectangles live on the remnant for one optimistic patch.',
      type: 'array',
      of: [defineArrayMember({type: 'allocation'})],
      initialValue: [],
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'fabric.name', status: 'status'},
    prepare: ({title, subtitle, status}) => ({
      title: title ?? 'Untitled remnant',
      subtitle: `${subtitle ?? 'Unnamed fabric'} · ${status ?? 'intake'}`,
    }),
  },
})
