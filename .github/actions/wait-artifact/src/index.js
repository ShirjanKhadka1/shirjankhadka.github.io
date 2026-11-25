/**
 * Wait until an artifact with the given name is visible to
 * DefaultArtifactClient.listArtifacts() — the exact view deploy-pages
 * reads (runner-internal Twirp results service, NOT the REST API).
 * The REST artifacts list can show the artifact seconds before the
 * Twirp view does; polling REST is therefore not a sufficient gate.
 */
const core = require('@actions/core')
const {DefaultArtifactClient} = require('@actions/artifact')

async function main() {
  const name = core.getInput('name', {required: true})
  const timeoutSeconds = parseInt(core.getInput('timeout-seconds') || '300', 10)
  const intervalMs = 5000
  const maxChecks = Math.max(1, Math.ceil((timeoutSeconds * 1000) / intervalMs))
  const client = new DefaultArtifactClient()
  for (let i = 1; i <= maxChecks; i++) {
    const {artifacts} = await client.listArtifacts()
    const found = artifacts.find(a => a.name === name)
    if (found) {
      core.info(`Artifact "${name}" visible to deploy-pages (check ${i}, id ${found.id})`)
      return
    }
    core.info(`Artifact "${name}" not yet visible (check ${i}/${maxChecks}); waiting ${intervalMs / 1000}s`)
    await new Promise(r => setTimeout(r, intervalMs))
  }
  core.setFailed(`Artifact "${name}" never became visible to deploy-pages after ${timeoutSeconds}s`)
}

main().catch(e => core.setFailed(e.message))
