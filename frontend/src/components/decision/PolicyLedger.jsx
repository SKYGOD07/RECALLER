/** Rule-by-rule policy evaluation, exactly as the engine returned it. */

import { Panel } from '@/components/common/ui.jsx'
import { num } from '@/lib/format'

const OUTCOME_KIND = { PASS: 'approve', REFER: 'refer', FAIL: 'reject', NOT_APPLICABLE: 'idle' }
const OUTCOME_LABEL = { PASS: 'Pass', REFER: 'Refer', FAIL: 'Fail', NOT_APPLICABLE: 'N/A' }

export default function PolicyLedger({ evaluation }) {
  const s = evaluation.summary

  return (
    <Panel
      title="Policy evaluation"
      meta={`${evaluation.policy_id} v${evaluation.policy_version} · ${evaluation.policy_hash}`}
    >
      <p className="rc-ledger__summary">
        <strong className="tnum">
          {num(s.passed)}/{num(s.total)}
        </strong>{' '}
        rules passed · {num(s.referred)} referred · {num(s.failed)} failed
      </p>

      <ul className="rc-ledger">
        {evaluation.rules.map((r) => (
          <li key={r.code} className={`rc-ledger__row rc-ledger__row--${OUTCOME_KIND[r.outcome]}`}>
            <span className="rc-ledger__code mono">{r.code}</span>
            <span className="rc-ledger__label">
              {r.label}
              <span className="rc-ledger__rationale">{r.rationale}</span>
            </span>
            <span className="rc-ledger__detail mono tnum">{r.detail || '—'}</span>
            <span className={`rc-ledger__outcome rc-ledger__outcome--${OUTCOME_KIND[r.outcome]}`}>
              {OUTCOME_LABEL[r.outcome]}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
