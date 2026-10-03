import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'

import {schemaTypes} from './sanity/schemaTypes'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim() ?? ''
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production'

export default defineConfig({
  name: 'tessom',
  title: 'Tessom',
  basePath: '/studio',
  projectId,
  dataset,
  apiVersion: '2026-10-01',
  plugins: [structureTool()],
  schema: {types: schemaTypes},
})
