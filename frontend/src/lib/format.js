/**
 * Display formatting only.
 *
 * Nothing here computes a credit figure. Ratios arrive from the engine as
 * ratios (0.1915) and are rendered as percentages; money arrives in rupees and
 * is grouped for an Indian reader. If a value is missing it renders as an
 * em dash rather than a zero, because a blank is not the same as nil.
 */

export const DASH = '—'

export function inr(value, { decimals = 0, compact = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return DASH
  const n = Number(value)
  if (compact && Math.abs(n) >= 100000) {
    return `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`
  }
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

/** Ratio → percentage string. 0.1915 → "19.15%" */
export function pct(ratio, decimals = 2) {
  if (ratio === null || ratio === undefined || Number.isNaN(Number(ratio))) return DASH
  return `${(Number(ratio) * 100).toFixed(decimals)}%`
}

export function num(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return DASH
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function dateTime(iso) {
  if (!iso) return DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function clockTime(iso) {
  if (!iso) return DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleTimeString('en-IN', { hour12: false })
}

export function duration(ms) {
  if (ms === null || ms === undefined) return DASH
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

/** Group a digest into readable quads: 4f8a92bc17e2… → 4F8A-92BC-17E2 */
export function fingerprint(hash, groups = 4) {
  if (!hash) return DASH
  return (
    String(hash)
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.slice(0, groups)
      .join('-') ?? DASH
  )
}

/** A value of any evidence type rendered for a table cell. */
export function evidenceValue(value, type) {
  if (value === null || value === undefined) return DASH
  if (Array.isArray(value)) {
    if (!value.length) return DASH
    if (typeof value[0] === 'object') return `${value.length} items`
    return value.map((v) => (typeof v === 'number' ? inr(v) : String(v))).join(' · ')
  }
  if (type === 'money') return inr(value, { decimals: 2 })
  if (typeof value === 'number') return num(value, Number.isInteger(value) ? 0 : 2)
  return String(value)
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
