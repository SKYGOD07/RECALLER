/**
 * RECALLER — monorepo alias resolution for Node.
 *
 * The domain packages import each other as `@core/...`, `@policy-engine/...`
 * and so on. Vite resolves those from frontend/vite.config.js, which is fine
 * for the console but leaves the same modules unloadable from a plain Node
 * script — which is why they had no tests.
 *
 * This registers a resolve hook carrying the identical alias table, so
 * scripts/ and the console load exactly the same files. Keep the two in step:
 * if an alias is added to vite.config.js it belongs here too.
 *
 * Usage:  node --import ./scripts/alias.mjs <script>
 */

import { register } from 'node:module'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

const ROOT = new URL('../', import.meta.url)

const ALIASES = {
  '@core/': 'packages/core/src/',
  '@extraction/': 'packages/extraction/src/',
  '@reconciliation/': 'packages/reconciliation/src/',
  '@credit-engine/': 'packages/credit-engine/src/',
  '@policy-engine/': 'packages/policy-engine/src/',
  '@narration/': 'packages/narration/src/',
  '@whatif/': 'packages/whatif/src/',
  '@orchestrator/': 'packages/orchestrator/src/',
  '@policy/': 'policy/',
  '@synthetic/': 'data/synthetic/',
}

export function resolveAlias(specifier) {
  for (const [prefix, target] of Object.entries(ALIASES)) {
    if (specifier.startsWith(prefix)) {
      return new URL(target + specifier.slice(prefix.length), ROOT).href
    }
  }
  return null
}

// The hook runs on a separate thread and cannot close over module state, so the
// table is passed through and the resolver is defined inline.
register(
  new URL('./alias-hooks.mjs', import.meta.url),
  pathToFileURL(fileURLToPath(ROOT)),
  { data: { aliases: ALIASES, root: ROOT.href } }
)

export { ALIASES, ROOT }
