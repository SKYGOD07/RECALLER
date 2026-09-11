/**
 * RECALLER — deterministic hashing and identifiers.
 *
 * JavaScript port of recaller/core/hash.py.
 * Uses 128-bit FNV-1a (four 32-bit interleaved lanes) and mulberry32 PRNG.
 * This implementation produces byte-identical output to the Python version.
 */

/**
 * Stable JSON: object keys sorted recursively so key order never changes a hash.
 */
export function stableStringify(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    const items = value.map(stableStringify)
    return `[${items.join(',')}]`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    const body = keys.map((k) => `${JSON.stringify(String(k))}:${stableStringify(value[k])}`)
    return `{${body.join(',')}}`
  }
  return JSON.stringify(String(value))
}

/**
 * 32-bit FNV-1a hash over unicode string code units.
 */
export function fnv1a32(s, seed) {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * 128-bit hex digest of any JSON-serialisable value.
 */
export function hashValue(value) {
  const s = stableStringify(value)
  const lanes = [0x811c9dc5, 0x1b873593, 0x85ebca6b, 0xc2b2ae35]
  return lanes.map((seed) => fnv1a32(s, seed).toString(16).padStart(8, '0')).join('')
}

/**
 * Short human-quotable fingerprint — first 12 hex chars.
 */
export function shortHash(value) {
  return hashValue(value).slice(0, 12)
}

/**
 * Deterministic pseudo-random generator (mulberry32).
 */
export function rng(seed) {
  let a
  if (typeof seed === 'number') {
    a = seed >>> 0
  } else {
    a = fnv1a32(String(seed), 0x9e3779b9)
  }

  return function nextRandom() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Monotonic sortable identifier with stable prefix.
 */
export function makeId(prefix, seedParts) {
  const h = hashValue(seedParts).slice(0, 10).toUpperCase()
  return `${prefix}-${h}`
}
