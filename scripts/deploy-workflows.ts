import {deployWorkflowDefinitions} from '../lib/workflow'

async function main(): Promise<void> {
  const result = await deployWorkflowDefinitions()

  if (!result) {
    console.error('Workflow deployment skipped: Sanity project, dataset, token, or workflow tag is not configured.')
    process.exitCode = 1
    return
  }

  for (const deployed of result.results) {
    console.log(`${deployed.name} v${deployed.version}: ${deployed.status}`)
  }
}

main().catch(() => {
  console.error('Workflow deployment failed. Check the Sanity project, dataset, token, and network connection.')
  process.exitCode = 1
})
