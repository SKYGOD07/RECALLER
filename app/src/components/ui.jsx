/**
 * RECALLER console — shared presentation primitives.
 *
 * These components render state; they never derive it. Anything that looks
 * like a judgement (a metric's colour band, a confidence class) is a direct
 * translation of a value the engine already produced, not a second opinion
 * computed in the browser.
 */

import { formatINR, formatPct } from '@/lib/format.js';
import { STATUS_LABELS } from '@/lib/vocab.js';

/* ---------------------------------------------------------------- Icons */

const PATHS = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  plus: 'M12 5v14M5 12h14',
  flow: 'M4 6h6M4 12h16M4 18h9M16 4l2 2-2 2M18 16l2 2-2 2',
  evidence: 'M6 2h9l5 5v15H6zM15 2v5h5M9 13h7M9 17h5',
  recon: 'M4 7h10M4 7l3-3M4 7l3 3M20 17H10M20 17l-3-3M20 17l-3 3',
  assist: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5M12 16.5v.5',
  credit: 'M3 17l5-6 4 4 5-7 4 5M3 21h18',
  policy: 'M5 3h11l4 4v14H5zM9 10h7M9 14h7M9 18h4',
  decision: 'M9 12l2.5 2.5L16 9M12 3a9 9 0 100 18 9 9 0 000-18z',
  memo: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  audit: 'M12 6v6l4 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  replay: 'M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14-3M4 15a8 8 0 0014 3',
  whatif: 'M4 20h16M7 20V9M12 20V4M17 20v-7',
  back: 'M15 18l-6-6 6-6',
  doc: 'M7 2h7l5 5v15H7zM14 2v5h5',
  check: 'M4 12l5 5L20 6',
  print: 'M7 8V3h10v5M7 18H5v-6h14v6h-2M8 14h8v7H8z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  chevron: 'M9 6l6 6-6 6',
};

export function Icon({ name, size = 15, className = '' }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/* ---------------------------------------------------------------- Pills */

const STATUS_TONE = {
  DRAFT: 'neutral',
  PROCESSING: 'busy',
  WAITING_FOR_OFFICER: 'warn',
  APPROVED: 'good',
  REFERRED: 'warn',
  REJECTED: 'bad',
  COMPLETED: 'acc',
  FAILED: 'bad',
};

export function StatusPill({ status }) {
  if (!status) return <span className="dim">—</span>;
  return (
    <span className={`pill pill--${STATUS_TONE[status] ?? 'neutral'}`}>
      <span className="pill__dot" />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const DECISION_TONE = { APPROVE: 'good', REFER: 'warn', REJECT: 'bad' };

export function DecisionPill({ decision }) {
  if (!decision) return <span className="dim">—</span>;
  return <span className={`pill pill--${DECISION_TONE[decision]}`}>{decision}</span>;
}

const FINDING_TONE = { MATCHED: 'good', ADVISORY: 'warn', MISMATCH: 'warn', BLOCKING: 'bad' };

export function FindingPill({ status }) {
  return <span className={`pill pill--${FINDING_TONE[status] ?? 'neutral'}`}>{status}</span>;
}

const OUTCOME_TONE = { PASS: 'good', REFER: 'warn', FAIL: 'bad', NOT_APPLICABLE: 'neutral' };

export function OutcomePill({ outcome }) {
  return (
    <span className={`pill pill--${OUTCOME_TONE[outcome] ?? 'neutral'}`}>
      {outcome === 'NOT_APPLICABLE' ? 'N/A' : outcome}
    </span>
  );
}

export function ActorTag({ actor }) {
  return <span className={`actor actor--${actor}`}>{actor}</span>;
}

/* ---------------------------------------------------------------- Cards */

export function Card({ title, eyebrow, tools, note, children, flush = false, className = '', style }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || tools) && (
        <header className="card__head">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="h2">{title}</h2>}
          </div>
          {tools && <div className="card__tools">{tools}</div>}
        </header>
      )}
      <div className={`card__body${flush ? ' card__body--flush' : ''}`}>{children}</div>
      {note && (
        <footer className="card__note">
          <Icon name="policy" size={13} />
          <span>{note}</span>
        </footer>
      )}
    </section>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {children && <div className="sub">{children}</div>}
    </div>
  );
}

export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <header className="pagehead">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="h1">{title}</h1>
        {sub && (
          <p className="sub" style={{ marginTop: 4, maxWidth: '72ch' }}>
            {sub}
          </p>
        )}
      </div>
      {actions && <div className="pagehead__actions">{actions}</div>}
    </header>
  );
}

/* -------------------------------------------------------------- Metrics */

/**
 * A metric tile. `band` is supplied by the caller from the policy rule that
 * governs the metric — the tile does not decide what "good" means.
 */
export function Metric({ label, value, sub, tone = 'neutral', fill = null, cap = null, hint }) {
  return (
    <div className={`metric metric--${tone}`}>
      <div className="metric__label">
        {label}
        {hint && (
          <span title={hint} style={{ cursor: 'help', opacity: 0.55 }}>
            <Icon name="assist" size={11} />
          </span>
        )}
      </div>
      <div className="metric__value">{value}</div>
      {sub && <div className="metric__sub">{sub}</div>}
      {fill !== null && (
        <div className="metric__bar">
          <div className="metric__fill" style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%` }} />
          {cap !== null && <span className="metric__cap" style={{ left: `${Math.min(100, cap * 100)}%` }} />}
        </div>
      )}
    </div>
  );
}

/** Tone for a ratio metric against its policy ceiling and referral band. */
export function ceilingTone(value, threshold, band) {
  if (value === null || value === undefined) return 'neutral';
  if (value <= threshold) return 'good';
  if (band && value <= band[1]) return 'warn';
  return 'bad';
}

export function floorTone(value, threshold, band) {
  if (value === null || value === undefined) return 'neutral';
  if (value >= threshold) return 'good';
  if (band && value >= band[0]) return 'warn';
  return 'bad';
}

/* ----------------------------------------------------------- Confidence */

export function Confidence({ value, floor }) {
  if (value === null || value === undefined) return <span className="dim">—</span>;
  const cls = value < (floor ?? 0.8) ? 'low' : value < 0.9 ? 'mid' : 'high';
  return (
    <span className={`conf conf--${cls}`}>
      <span className="conf__track">
        <span className="conf__fill" style={{ width: `${value * 100}%` }} />
      </span>
      {(value * 100).toFixed(1)}%
    </span>
  );
}

/* --------------------------------------------------------------- Values */

export function Money({ value, decimals = 0 }) {
  return <span className="num">{formatINR(value, { decimals })}</span>;
}

export function Pct({ value, dp = 1 }) {
  return <span className="num">{formatPct(value, dp)}</span>;
}

export function Mono({ children, className = '' }) {
  return <span className={`mono ${className}`}>{children}</span>;
}

export function KV({ rows, left = false }) {
  return (
    <table className={`kv${left ? ' kv--left' : ''}`}>
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`}>
            <td>{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__err">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function CopyButton({ text, label = 'Copy' }) {
  return (
    <button
      type="button"
      className="btn btn--sm btn--ghost"
      onClick={() => navigator.clipboard?.writeText(text)}
      title={text}
    >
      <Icon name="copy" size={12} />
      {label}
    </button>
  );
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (!Number.isFinite(mins)) return '—';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatClock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
