import {defineField, defineType} from 'sanity'

import {enumOptions, enumValidation, OWNER_KINDS} from './shared'

/**
 * A fabric offered through the public form. It lives on a private ID path
 * ("submissions.<id>") so the public dataset never returns it, and the
 * contact is stored encrypted. The workshop reviews it before any remnant exists.
 */
export const submission = defineType({
  name: 'submission',
  title: 'Fabric submission',
  type: 'document',
  readOnly: true,
  fields: [
    defineField({name: 'kind', title: 'Submitter kind', type: 'string', options: enumOptions(OWNER_KINDS), validation: (Rule) => enumValidation(Rule, OWNER_KINDS)}),
    defineField({name: 'fabricName', title: 'Fabric name', type: 'string', validation: (Rule) => Rule.max(160)}),
    defineField({name: 'maker', title: 'Maker', type: 'string', validation: (Rule) => Rule.max(160)}),
    defineField({name: 'widthCm', title: 'Width (cm)', type: 'number', validation: (Rule) => Rule.required().positive()}),
    defineField({name: 'heightCm', title: 'Height (cm)', type: 'number', validation: (Rule) => Rule.required().positive()}),
    defineField({name: 'directional', title: 'Directional fabric', type: 'boolean', initialValue: false}),
    defineField({name: 'notes', title: 'Notes and flaws', type: 'text', rows: 4, validation: (Rule) => Rule.max(1000)}),
    defineField({name: 'photo', title: 'Photo', type: 'image'}),
    defineField({name: 'contact', title: 'Encrypted contact', type: 'object', fields: [
      defineField({name: 'algorithm', type: 'string'}),
      defineField({name: 'version', type: 'number'}),
      defineField({name: 'iv', type: 'string'}),
      defineField({name: 'authTag', type: 'string'}),
      defineField({name: 'ciphertext', type: 'string'}),
    ]}),
    defineField({name: 'status', title: 'Status', type: 'string', options: enumOptions(['new', 'accepted', 'declined']), initialValue: 'new'}),
    defineField({name: 'createdAt', title: 'Created', type: 'datetime'}),
  ],
  preview: {select: {title: 'fabricName', subtitle: 'status'}, prepare: ({title, subtitle}) => ({title: title || 'Unnamed fabric', subtitle: `Submission · ${subtitle ?? 'new'}`})},
})
