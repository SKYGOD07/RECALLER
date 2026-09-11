/**
 * Display formatting only. The console performs no credit arithmetic: every
 * figure it shows arrived from the backend already computed.
 */

/** Half-up rounding for display. */
export function round(value, dp = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value) * f;
  return (sign * Math.round(abs + Number.EPSILON * abs)) / f;
}

/** Indian-grouped currency, e.g. ₹1,23,456.00 */
export function formatINR(rupees, { decimals = 0, symbol = true } = {}) {
  if (rupees === null || rupees === undefined || !Number.isFinite(Number(rupees))) return '—';
  const n = Number(rupees);
  const [whole, frac] = Math.abs(n).toFixed(decimals).split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${n < 0 ? '-' : ''}${symbol ? '₹' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** A ratio as a percentage string. */
export function formatPct(ratio, dp = 1) {
  if (ratio === null || ratio === undefined || !Number.isFinite(Number(ratio))) return '—';
  return `${round(Number(ratio) * 100, dp).toFixed(dp)}%`;
}

export function formatBytes(kb) {
  if (kb === null || kb === undefined) return '—';
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
}
