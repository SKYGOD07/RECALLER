/**
 * "Every document has a story. We check whether they agree."
 *
 * Each finding is a pair of observations from two different sources, with the
 * tolerance that judged them. Nothing here re-scores anything: status, delta
 * and similarity all arrive from the reconciliation engine.
 */

import { Panel, Tag } from '@/components/common/ui.jsx'
import { DASH, inr, num, pct } from '@/lib/format'

const STATUS_KIND = { MATCHED: 'approve', ADVISORY: 'refer', MISMATCH: 'refer', BLOCKING: 'reject' }

const STATUS_COPY = {
  MATCHED: 'Sources agree',
  ADVISORY: 'Worth an officer’s eye',
  MISMATCH: 'Worth an officer’s eye',
  BLOCKING: 'Must be cleared before sanction',
}

const side = (s) => {
  if (!s) return DASH
  if (s.kind === 'money') return inr(s.value, { decimals: 2 })
  if (Array.isArray(s.value)) return `${s.value.length} values`
  return String(s.value ?? DASH)
}

function Tolerance({ finding }) {
  const t = finding.tolerance ?? {}
  if (finding.similarity !== undefined) {
    return (
      <p className="finding__tol tnum">
        Similarity {pct(finding.similarity, 0)} · advisory below {pct(t.advisory_score, 0)} · blocking below{' '}
        {pct(t.blocking_score, 0)}
      </p>
    )
  }
  return (
    <p className="finding__tol tnum">
      Difference {finding.delta_pct === null || finding.delta_pct === undefined ? DASH : pct(finding.delta_pct)}
      {finding.delta === null || finding.delta === undefined ? '' : ` (${inr(finding.delta, { decimals: 2 })})`} ·
      advisory above {pct(t.advisory_pct, 0)} · blocking above {pct(t.blocking_pct, 0)}
    </p>
  )
}

function Finding({ finding }) {
  const kind = STATUS_KIND[finding.status] ?? 'idle'
  const { left, right } = finding.comparison ?? {}

  return (
    <li className={`finding finding--${kind}`}>
      <header className="finding__head">
        <span className="finding__code mono">{finding.code}</span>
        <h4 className="finding__label">{finding.label}</h4>
        <Tag kind={kind}>{finding.status}</Tag>
      </header>

      <div className="finding__pair">
        <div className="finding__side">
          <span className="finding__k caps">{left?.field ?? 'Left'}</span>
          <span className="finding__v tnum">{side(left)}</span>
          <span className="finding__src mono t3">{left?.source ?? DASH}</span>
        </div>

        <div className={`finding__link finding__link--${kind}`} aria-hidden="true">
          <span className="finding__line" />
          <span className="finding__verdict caps">{finding.status}</span>
          <span className="finding__line" />
        </div>

        <div className="finding__side">
          <span className="finding__k caps">{right?.field ?? 'Right'}</span>
          <span className="finding__v tnum">{side(right)}</span>
          <span className="finding__src mono t3">{right?.source ?? DASH}</span>
        </div>
      </div>

      <p className="finding__why">{STATUS_COPY[finding.status]}</p>
      <Tolerance finding={finding} />
      {finding.note ? <p className="finding__note">{finding.note}</p> : null}
    </li>
  )
}

export default function Reconciliation({ reconciliation }) {
  const { findings = [], blocking = 0, advisory = 0, matched = 0, total = 0 } = reconciliation ?? {}

  return (
    <Panel title="Cross-document reconciliation" meta={`${num(total)} checks`}>
      <div className="recon__summary">
        <span className="recon__stat recon__stat--approve">
          <strong className="tnum">{num(matched)}</strong> matched
        </span>
        <span className="recon__stat recon__stat--refer">
          <strong className="tnum">{num(advisory)}</strong> advisory
        </span>
        <span className="recon__stat recon__stat--reject">
          <strong className="tnum">{num(blocking)}</strong> blocking
        </span>
      </div>

      <ul className="findings">
        {findings.map((f) => (
          <Finding key={f.code} finding={f} />
        ))}
      </ul>
    </Panel>
  )
}
