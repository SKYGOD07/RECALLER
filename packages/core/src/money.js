/**
 * RECALLER — deterministic money primitives.
 *
 * All monetary arithmetic is carried out in integer paise to remove binary
 * floating point drift from the credit path. Every function here is pure and
 * must produce byte-identical output for identical input, on any machine, for
 * any run. This is the contract that makes replay meaningful.
 */

/** Convert rupees (number or numeric string) to integer paise. */
export function toPaise(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') return 0;
  const n = typeof rupees === 'string' ? Number(rupees.replace(/[,\s₹]/g, '')) : Number(rupees);
  if (!Number.isFinite(n)) throw new TypeError(`toPaise: not a finite number: ${rupees}`);
  // Scale then round half-up away from zero so -0.005 and 0.005 behave symmetrically.
  const scaled = n * 100;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
}

/** Convert integer paise back to a rupee number with 2 decimal places. */
export function toRupees(paise) {
  return Math.round(paise) / 100;
}

/** Half-up rounding to a fixed number of decimal places. */
export function round(value, dp = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value) * f;
  return (sign * Math.round(abs + Number.EPSILON * abs)) / f;
}

/** Sum a list of rupee amounts without accumulating float error. */
export function sum(amounts) {
  return toRupees(amounts.reduce((acc, a) => acc + toPaise(a), 0));
}

/** Format as Indian-grouped currency, e.g. 1,23,456.00 */
export function formatINR(rupees, { decimals = 0, symbol = true } = {}) {
  if (rupees === null || rupees === undefined || !Number.isFinite(Number(rupees))) return '—';
  const n = Number(rupees);
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  // Indian grouping: last three digits, then pairs.
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '-' : ''}${symbol ? '₹' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Format a ratio as a percentage string. */
export function formatPct(ratio, dp = 1) {
  if (ratio === null || ratio === undefined || !Number.isFinite(Number(ratio))) return '—';
  return `${round(Number(ratio) * 100, dp).toFixed(dp)}%`;
}
