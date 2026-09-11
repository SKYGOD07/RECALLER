/** Console primitives. Presentational only — no component in here fetches or computes. */

import { DASH } from '@/lib/format'

const DECISION_KIND = {
  APPROVE: 'approve',
  REFER: 'refer',
  REJECT: 'reject',
}

const STATUS_KIND = {
  DRAFT: 'idle',
  PROCESSING: 'busy',
  WAITING_FOR_OFFICER: 'refer',
  APPROVED: 'approve',
  REFERRED: 'refer',
  REJECTED: 'reject',
  COMPLETED: 'approve',
  FAILED: 'reject',
}

export const STATUS_LABELS = {
  DRAFT: 'Not started',
  PROCESSING: 'Underwriting',
  WAITING_FOR_OFFICER: 'Awaiting officer',
  APPROVED: 'Approved',
  REFERRED: 'Referred',
  REJECTED: 'Declined',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
}

export const decisionKind = (decision) => DECISION_KIND[decision] ?? 'idle'
export const statusKind = (status) => STATUS_KIND[status] ?? 'idle'

export function Tag({ kind = 'idle', pulse = false, children, className = '' }) {
  return (
    <span className={`tag tag--${kind}${pulse ? ' tag--pulse' : ''} ${className}`}>
      <i className="tag__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function StatusTag({ status }) {
  return (
    <Tag kind={statusKind(status)} pulse={status === 'PROCESSING'}>
      {STATUS_LABELS[status] ?? status}
    </Tag>
  )
}

export function DecisionTag({ decision }) {
  if (!decision) return <Tag kind="idle">Undecided</Tag>
  return <Tag kind={decisionKind(decision)}>{decision}</Tag>
}

/**
 * One figure. `value` is always a formatted string that came from the engine —
 * the component never receives a raw number to do arithmetic on.
 */
export function Metric({ label, value, sub, kind = 'idle', size = 'md' }) {
  return (
    <div className={`metric metric--${size} metric--${kind}`}>
      <span className="metric__label">{label}</span>
      <strong className="metric__value tnum">{value ?? DASH}</strong>
      {sub ? <span className="metric__sub">{sub}</span> : null}
    </div>
  )
}

/**
 * A ratio drawn against its policy limit on a 0–100% track. Both numbers are
 * read as given — the bar is geometry, not arithmetic on a credit figure.
 */
export function LimitBar({ value, limit, kind = 'approve', label }) {
  const width = Math.max(0, Math.min(1, Number(value) || 0)) * 100
  const tick = limit === undefined || limit === null ? null : Math.min(1, Number(limit)) * 100
  return (
    <div className="limitbar" role="img" aria-label={label}>
      <span className={`limitbar__fill limitbar__fill--${kind}`} style={{ width: `${width}%` }} />
      {tick === null ? null : <span className="limitbar__tick" style={{ left: `${tick}%` }} aria-hidden="true" />}
    </div>
  )
}

export function Panel({ title, meta, action, children, className = '', as: Tagname = 'section' }) {
  return (
    <Tagname className={`cpanel ${className}`}>
      {title ? (
        <header className="cpanel__head">
          <h3 className="cpanel__title">{title}</h3>
          <div className="cpanel__meta">
            {meta ? <span className="caps t3">{meta}</span> : null}
            {action}
          </div>
        </header>
      ) : null}
      <div className="cpanel__body">{children}</div>
    </Tagname>
  )
}

export function Field({ label, children, mono = false }) {
  return (
    <div className="cfield">
      <span className="cfield__label">{label}</span>
      <span className={`cfield__value${mono ? ' mono' : ''}`}>{children ?? DASH}</span>
    </div>
  )
}

export function Skeleton({ lines = 3, className = '' }) {
  return (
    <div className={`skel ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skel__line" style={{ width: `${92 - i * 13}%` }} />
      ))}
    </div>
  )
}

export function Loading({ message = 'Loading' }) {
  return (
    <div className="cstate" role="status">
      <span className="cstate__spinner" aria-hidden="true" />
      <p className="cstate__title">{message}</p>
    </div>
  )
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="cstate cstate--empty">
      <p className="cstate__title">{title}</p>
      {body ? <p className="cstate__body">{body}</p> : null}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Something did not complete', body, onRetry }) {
  return (
    <div className="cstate cstate--error" role="alert">
      <p className="cstate__title">{title}</p>
      {body ? <p className="cstate__body">{body}</p> : null}
      {onRetry ? (
        <button type="button" className="cbtn cbtn--ghost" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function CButton({ variant = 'primary', size, kind, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`cbtn cbtn--${variant}${size ? ` cbtn--${size}` : ''}${kind ? ` cbtn--${kind}` : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
