// Builds a per-run state directory from the committed fixture templates.
import { mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURES = join(REPO, 'fixtures')

/**
 * @param dir          destination state directory (recreated)
 * @param chain        fixture chain name under fixtures/chains
 * @param revocations  fixture name under fixtures/revocations, or 'absent'
 * @param stampNow     true to stamp generated_at to now (a live feed), false to
 *                     keep the fixture's own stamp (the deliberately stale case)
 */
export function buildStateDir(dir, { chain, revocations, stampNow = true }) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(join(FIXTURES, 'mapping.TEST-ONLY.json'), join(dir, 'mapping.json'))
  copyFileSync(join(FIXTURES, 'trust-anchors.TEST-ONLY.json'), join(dir, 'trust-anchors.json'))
  if (chain !== 'absent') {
    copyFileSync(join(FIXTURES, 'chains', `${chain}.json`), join(dir, 'chain.json'))
  }
  if (revocations !== 'absent') {
    writeRevocations(dir, revocations, stampNow)
  }
  return dir
}

export function writeRevocations(dir, revocations, stampNow = true) {
  const source = join(FIXTURES, 'revocations', `${revocations}.json`)
  if (revocations === 'malformed') {
    copyFileSync(source, join(dir, 'revocations.json'))
    return
  }
  const state = JSON.parse(readFileSync(source, 'utf8'))
  if (stampNow) state.generated_at = new Date().toISOString()
  writeFileSync(join(dir, 'revocations.json'), JSON.stringify(state, null, 2) + '\n')
}
