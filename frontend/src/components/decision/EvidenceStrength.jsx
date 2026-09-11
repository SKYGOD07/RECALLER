/**
 * Evidence strength, as the engine returned it.
 *
 * The one figure on this screen that is not about money: how much of the file
 * we actually know. It sits beside the decision because it qualifies it — a
 * decision on a thin file and the same decision on a complete one are not the
 * same decision — but no policy rule reads it, and it changes no outcome.
 */

import { Panel, Tag } from '@/components/common/ui.jsx'
import { num } from '@/lib/format'

const BAND_KIND = {
  STRONG: 'approve',
  ADEQUATE: 'ai',
  THIN: 'refer',
  WEAK: 'reject',
}

export default function EvidenceStrength({ strength }) {
  if (!strength) return null
  const kind = BAND_KIND[strength.band] ?? 'idle'

  return (
    <Panel title="Evidence strength" meta="Scores the file, not the borrower">
      <div className={`estr estr--${kind}`}>
        <div className="estr__head">
          <strong className="estr__score tnum">
            {num(strength.score)}
            <i>/100</i>
          </strong>
          <Tag kind={kind}>{strength.band}</Tag>
        </div>

        <ul className="estr__rows">
          {strength.components.map((c) => (
            <li className="estr__row" key={c.key}>
              <span className="estr__label">{c.label}</span>
              <span className="estr__track">
                <span
                  className={`estr__fill estr__fill--${kind}`}
                  style={{ width: `${(c.points / c.max) * 100}%` }}
                />
              </span>
              <span className="estr__points tnum">
                {c.points}
                <i>/{c.max}</i>
              </span>
              <span className="estr__detail">{c.detail}</span>
            </li>
          ))}
        </ul>

        <p className="estr__note">
          Four components of {num(25)}, each read from evidence that already cleared the confidence gate.
          Thresholds come from the policy document, so moving a cutoff moves this too.
        </p>
      </div>
    </Panel>
  )
}
