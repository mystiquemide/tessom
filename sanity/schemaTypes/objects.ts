import {defineField, defineType} from 'sanity'

import {nonNegative, positive, positiveInteger} from './shared'

export const fabric = defineType({
  name: 'fabric',
  title: 'Fabric',
  type: 'object',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required().max(160),
    }),
    defineField({
      name: 'maker',
      title: 'Maker',
      type: 'string',
      validation: (Rule) => Rule.required().max(160),
    }),
    defineField({
      name: 'valuePerM',
      title: 'Value per metre',
      description: 'The workshop valuation in the project currency per metre.',
      type: 'number',
      validation: positive,
    }),
  ],
  preview: {select: {title: 'name', subtitle: 'maker'}},
})

export const repeat = defineType({
  name: 'repeat',
  title: 'Pattern repeat',
  type: 'object',
  fields: [
    defineField({
      name: 'vCm',
      title: 'Vertical repeat (cm)',
      type: 'number',
      validation: positive,
    }),
    defineField({
      name: 'hCm',
      title: 'Horizontal repeat (cm)',
      type: 'number',
      validation: positive,
    }),
  ],
  preview: {
    select: {vertical: 'vCm', horizontal: 'hCm'},
    prepare: ({vertical, horizontal}) => ({
      title: `${vertical ?? '?'} × ${horizontal ?? '?'} cm`,
      subtitle: 'Pattern repeat',
    }),
  },
})

export const defect = defineType({
  name: 'defect',
  title: 'Defect rectangle',
  type: 'object',
  fields: [
    defineField({name: 'x', title: 'X (cm)', type: 'number', validation: nonNegative}),
    defineField({name: 'y', title: 'Y (cm)', type: 'number', validation: nonNegative}),
    defineField({name: 'w', title: 'Width (cm)', type: 'number', validation: positive}),
    defineField({name: 'h', title: 'Height (cm)', type: 'number', validation: positive}),
  ],
  preview: {
    select: {x: 'x', y: 'y', width: 'w', height: 'h'},
    prepare: ({x, y, width, height}) => ({
      title: `${width ?? '?'} × ${height ?? '?'} cm`,
      subtitle: `At ${x ?? '?'}, ${y ?? '?'}`,
    }),
  },
})

export const allocation = defineType({
  name: 'allocation',
  title: 'Allocated area',
  type: 'object',
  fields: [
    defineField({name: 'x', title: 'X (cm)', type: 'number', validation: nonNegative}),
    defineField({name: 'y', title: 'Y (cm)', type: 'number', validation: nonNegative}),
    defineField({name: 'w', title: 'Width (cm)', type: 'number', validation: positive}),
    defineField({name: 'h', title: 'Height (cm)', type: 'number', validation: positive}),
    defineField({
      name: 'order',
      title: 'Order',
      type: 'reference',
      to: [{type: 'order'}],
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: {x: 'x', y: 'y', width: 'w', height: 'h', order: 'order._ref'},
    prepare: ({x, y, width, height, order}) => ({
      title: `${width ?? '?'} × ${height ?? '?'} cm`,
      subtitle: `At ${x ?? '?'}, ${y ?? '?'} · ${order ?? 'order pending'}`,
    }),
  },
})

export const templatePiece = defineType({
  name: 'templatePiece',
  title: 'Template piece',
  type: 'object',
  fields: [
    defineField({
      name: 'label',
      title: 'Label',
      type: 'string',
      validation: (Rule) => Rule.required().max(80),
    }),
    defineField({name: 'wCm', title: 'Width (cm)', type: 'number', validation: positive}),
    defineField({name: 'hCm', title: 'Height (cm)', type: 'number', validation: positive}),
    defineField({
      name: 'qty',
      title: 'Quantity',
      description: 'How many identical rectangles this piece contributes.',
      type: 'number',
      validation: positiveInteger,
    }),
    defineField({
      name: 'centerPattern',
      title: 'Centre pattern',
      type: 'boolean',
      initialValue: false,
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: {label: 'label', width: 'wCm', height: 'hCm', qty: 'qty'},
    prepare: ({label, width, height, qty}) => ({
      title: label ?? 'Unnamed piece',
      subtitle: `${qty ?? '?'} × ${width ?? '?'} × ${height ?? '?'} cm`,
    }),
  },
})

export const placement = defineType({
  name: 'placement',
  title: 'Piece placement',
  type: 'object',
  fields: [
    defineField({name: 'x', title: 'X (cm)', type: 'number', validation: nonNegative}),
    defineField({name: 'y', title: 'Y (cm)', type: 'number', validation: nonNegative}),
    defineField({name: 'w', title: 'Width (cm)', type: 'number', validation: positive}),
    defineField({name: 'h', title: 'Height (cm)', type: 'number', validation: positive}),
    defineField({
      name: 'rotated',
      title: 'Rotated',
      type: 'boolean',
      initialValue: false,
      validation: (Rule) => Rule.required(),
    }),
  ],
  preview: {
    select: {x: 'x', y: 'y', width: 'w', height: 'h', rotated: 'rotated'},
    prepare: ({x, y, width, height, rotated}) => ({
      title: `${width ?? '?'} × ${height ?? '?'} cm`,
      subtitle: `At ${x ?? '?'}, ${y ?? '?'}${rotated ? ' · rotated' : ''}`,
    }),
  },
})

export const objectTypes = [fabric, repeat, defect, allocation, templatePiece, placement]
