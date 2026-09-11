/**
 * RECALLER — deterministic money primitives.
 *
 * JavaScript port of recaller/core/money.py.
 * All monetary arithmetic is carried out in integer paise to remove binary
 * floating-point drift from the credit path. Every function here is pure and
 * produces byte-identical output for identical input.
 */

const EPSILON = Number.EPSILON // 2.220446049250313e-16

/**
 * Convert rupees (number or numeric string) to integer paise.
 */
export function toPaise(rupees) {
  if (rupees == null || rupees === '') return 0
  let val
  if (typeof rupees === 'string') {
    const cleaned = rupees.replace(/[,\s₹]/g, '')
    val = Number(cleaned)
  } else {
    val = Number(rupees)
  }
  if (!Number.isFinite(val)) throw new TypeError(`toPaise: not a finite number: ${rupees}`)
  const scaled = val * 100
  const sign = scaled < 0 ? -1 : 1
  const absScaled = Math.abs(scaled)
  return sign * Math.floor(absScaled + EPSILON * absScaled + 0.5)
}

/**
 * Convert integer paise back to a rupee float with 2 decimal places.
 */
export function toRupees(paise) {
  return roundHalfUp(paise / 100, 2)
}

/**
 * Half-up rounding away from zero to a fixed number of decimal places.
 */
export function roundHalfUp(value, dp = 2) {
  if (value == null || !Number.isFinite(value)) return 0
  const f = 10 ** dp
  const sign = value < 0 ? -1 : 1
  const absVal = Math.abs(value) * f
  const rounded = Math.floor(absVal + EPSILON * absVal + 0.5)
  return (sign * rounded) / f
}

/**
 * Sum a list of rupee amounts in integer paise without accumulating float error.
 */
export function sumRupees(amounts) {
  const totalPaise = amounts.reduce((acc, a) => acc + toPaise(a), 0)
  return toRupees(totalPaise)
}

/**
 * Format as Indian-grouped currency, e.g. ₹1,23,45,678 or ₹1,23,456.00.
 */
export function formatInr(rupees, { decimals = 0, symbol = true } = {}) {
  if (rupees == null || rupees === '') return '—'
  let n
  try {
    n = Number(rupees)
  } catch {
    return '—'
  }
  if (!Number.isFinite(n)) return '—'

  const neg = n < 0
  const absN = Math.abs(n)
  let whole, frac
  if (decimals > 0) {
    const fixed = absN.toFixed(decimals)
    const parts = fixed.split('.')
    whole = parts[0]
    frac = parts[1]
  } else {
    whole = String(Math.round(absN))
    frac = ''
  }

  const last3 = whole.length >= 3 ? whole.slice(-3) : whole
  const rest = whole.length >= 3 ? whole.slice(0, -3) : ''

  let grouped
  if (rest) {
    const groupedRest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
    grouped = `${groupedRest},${last3}`
  } else {
    grouped = last3
  }

  const prefix = (neg ? '-' : '') + (symbol ? '₹' : '')
  const suffix = frac ? `.${frac}` : ''
  return `${prefix}${grouped}${suffix}`
}

/**
 * Format a ratio as a percentage string (e.g. 0.3 -> 30.0%).
 */
export function formatPct(ratio, dp = 1) {
  if (ratio == null || ratio === '') return '—'
  let val
  try {
    val = Number(ratio)
  } catch {
    return '—'
  }
  if (!Number.isFinite(val)) return '—'
  const pct = roundHalfUp(val * 100, dp)
  if (dp === 0) return `${Math.round(pct)}%`
  return `${pct.toFixed(dp)}%`
}
