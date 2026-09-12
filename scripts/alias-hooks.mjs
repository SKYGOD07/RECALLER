/**
 * RECALLER — the resolve hook itself.
 *
 * Runs on Node's module-customisation thread. It receives the alias table from
 * scripts/alias.mjs through `initialize`, so there is one table in the
 * repository rather than two that can drift.
 */

let aliases = {}
let root = ''

export function initialize(data) {
  aliases = data?.aliases || {}
  root = data?.root || ''
}

export function resolve(specifier, context, nextResolve) {
  for (const [prefix, target] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) {
      const url = new URL(target + specifier.slice(prefix.length), root).href
      return { url, shortCircuit: true, format: url.endsWith('.json') ? 'json' : undefined }
    }
  }
  return nextResolve(specifier, context)
}
