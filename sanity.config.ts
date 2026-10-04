import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {workflowDefaultDocumentNode, workflowStudioPlugin} from '@sanity/workflow-studio-plugin'

import {resolveFabricExtractionActions} from './sanity/fabric-extraction/action'
import {schemaTypes} from './sanity/schemaTypes'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim() ?? ''
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production'
const workflowTag = process.env.NEXT_PUBLIC_WORKFLOW_TAG?.trim() || 'tessom-dev'

export default defineConfig({
  name: 'tessom',
  title: 'Tessom',
  basePath: '/studio',
  projectId,
  dataset,
  apiVersion: '2026-10-01',
  plugins: [
    structureTool({defaultDocumentNode: workflowDefaultDocumentNode()}),
    workflowStudioPlugin({tag: workflowTag}),
    visionTool({defaultApiVersion: '2026-10-01'}),
  ],
  document: {actions: resolveFabricExtractionActions},
  schema: {types: schemaTypes},
})
