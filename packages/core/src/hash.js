/**
 * RECALLER — deterministic hashing and identifiers.
 *
 * Used to fingerprint policy documents, evidence bundles and calculation
 * inputs so that a replay can prove it ran against the same material. The
 * implementation is intentionally dependency-free (FNV-1a, 128-bit via four
 * interleaved 32-bit lanes) so it behaves identically in Node and the browser
 * without WebCrypto's async surface.
 */

/** Stable JSON: object keys sorted recursively so key order never changes a hash. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',');
  return `{${body}}`;
}

function fnv1a32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 128-bit hex digest of any JSON-serialisable value. */
export function hashValue(value) {
  const s = stableStringify(value);
  const lanes = [0x811c9dc5, 0x1b873593, 0x85ebca6b, 0xc2b2ae35];
  return lanes.map((seed) => fnv1a32(s, seed).toString(16).padStart(8, '0')).join('');
}

/** Short, human-quotable fingerprint — first 12 hex chars, grouped. */
export function shortHash(value) {
  return hashValue(value).slice(0, 12);
}

/**
 * Deterministic pseudo-random generator (mulberry32).
 * Synthetic data and simulated extraction jitter must be reproducible, so no
 * part of RECALLER ever calls Math.random().
 */
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : fnv1a32(String(seed), 0x9e3779b9);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monotonic, sortable identifier with a stable prefix. */
export function makeId(prefix, seedParts) {
  const h = hashValue(seedParts).slice(0, 10).toUpperCase();
  return `${prefix}-${h}`;
}
