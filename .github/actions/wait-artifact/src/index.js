/**
 * Wait until an artifact with the given name is STABLY visible to
 * DefaultArtifactClient.listArtifacts() — the exact view deploy-pages
 * reads (runner-internal Twirp results service, NOT the REST API).
 * The REST artifacts list can show the artifact seconds before the
 * Twirp view does; polling REST is therefore not a sufficient gate.
 *
 * A single sighting is NOT enough: on 2026-11-25 two Publish runs
 * (45604561498 on data ef5c4f0, 45614148061 on data 0e2563a) passed
 * this wait and then deploy-pages still failed with 'No artifacts
 * named "github-pages" were found' — the results service's
 * ListArtifacts view is eventually consistent and a later read can
 * miss an artifact an earlier read returned. So require the artifact
 * on TWO consecutive checks, then settle 10s before returning, so
 * deploy-pages lists well after first visibility.
 */
const core = require('@actions/core')
const {DefaultArtifactClient} = require('@actions/artifact')

async function main() {
  const name = core.getInput('name', {required: true})
  const timeoutSeconds = parseInt(core.getInput('timeout-seconds') || '300', 10)
  const intervalMs = 5000
  const settleMs = 10000
  const requiredConsecutive = 2
  const maxChecks = Math.max(1, Math.ceil((timeoutSeconds * 1000) / intervalMs))
  const client = new DefaultArtifactClient()
  let consecutive = 0
  for (let i = 1; i <= maxChecks; i++) {
    const {artifacts} = await client.listArtifacts()
    const found = artifacts.find(a => a.name === name)
    if (found) {
      consecutive += 1
      core.info(`Artifact "${name}" visible to deploy-pages (check ${i}, id ${found.id}, consecutive ${consecutive}/${requiredConsecutive})`)
      if (consecutive >= requiredConsecutive) {
        core.info(`Artifact "${name}" stably visible; settling ${settleMs / 1000}s before deploy-pages lists`)
        await new Promise(r => setTimeout(r, settleMs))
        return
      }
    } else {
      consecutive = 0
      core.info(`Artifact "${name}" not yet visible (check ${i}/${maxChecks}); waiting ${intervalMs / 1000}s`)
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  core.setFailed(`Artifact "${name}" never became stably visible to deploy-pages after ${timeoutSeconds}s`)
}

main().catch(e => core.setFailed(e.message))
