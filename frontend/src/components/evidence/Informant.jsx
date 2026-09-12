/**
 * The informal-lender reference, shown as what it is: testimony.
 *
 * A thin-file borrower is rarely a no-credit borrower — they have usually been
 * lent to for years by a shopkeeper or a chit fund and repaid, and nobody wrote
 * it down. This panel shows what that counterparty said, how much of it hangs
 * together, and exactly what it did to the obligation total.
 *
 * The one thing it must never do is let the reference read like a verified
 * document, so the ceiling is stated on the face of the panel rather than
 * buried: whatever else is true, this evidence is capped.
 */

import { LimitBar, Panel, Tag } from '@/components/common/ui.jsx'
import { DASH, inr, num, pct } from '@/lib/format'

const RELATIONSHIP_LABELS = {
  INFORMAL_LENDER: 'Private moneylender',
  SHOPKEEPER_CREDIT: 'Shopkeeper running account',
  CHIT_FUND: 'Chit fund',
  SHG: 'Self-help group',
  EMPLOYER_ADVANCE: 'Employer advance',
  FAMILY: 'Family',
}

function Signal({ label, value, hint, kind = 'approve' }) {
  return (
    <div className="inf__signal">
      <span className="inf__signal-label caps t4">{label}</span>
      <LimitBar value={value} kind={kind} label={`${label} ${pct(value, 0)}`} />
      <span className="inf__signal-value tnum">{pct(value, 0)}</span>
      {hint ? <span className="inf__signal-hint t4">{hint}</span> : null}
    </div>
  )
}

export default function Informant({ values, credit }) {
  const informant = values?.informant
  if (!informant || !Object.keys(informant).length) return null

  const q = informant._attestation ?? {}
  const coherence = q.coherence ?? {}
  const problems = coherence.problems ?? []
  const informal = credit?.informal_credit ?? {}

  const who = informant.business_name || informant.name || 'Informant'
  const relationship =
    RELATIONSHIP_LABELS[informant.relationship] ?? informant.relationship ?? DASH

  return (
    <Panel
      title="Informal-lender reference"
      meta={`Attested · confidence capped at ${pct(q.ceiling, 0)}`}
    >
      <div className="inf">
        <header className="inf__head">
          <div>
            <h4 className="inf__who">{who}</h4>
            <p className="inf__rel t3">
              {relationship}
              {informant.months_known != null
                ? ` · ${num(informant.months_known)} months`
                : ''}
            </p>
          </div>
          <div className="inf__tags">
            <Tag kind={q.contact_verified ? 'approve' : 'refer'}>
              {q.contact_verified ? 'Contact verified' : 'Contact unverified'}
            </Tag>
            <Tag kind={q.arms_length ? 'idle' : 'refer'}>
              {q.arms_length ? "Arm's length" : "Not arm's length"}
            </Tag>
          </div>
        </header>

        {/* What they said. Plain statement, no interpretation. */}
        <dl className="inf__ledger">
          <div>
            <dt>Principal lent</dt>
            <dd className="tnum">{inr(informant.principal_lent)}</dd>
          </div>
          <div>
            <dt>Still outstanding</dt>
            <dd className="tnum">{inr(informant.current_outstanding)}</dd>
          </div>
          <div>
            <dt>Monthly repayment</dt>
            <dd className="tnum">{inr(informant.monthly_repayment)}</dd>
          </div>
          <div>
            <dt>Missed (12m)</dt>
            <dd className="tnum">{num(informant.missed_payments_12m)}</dd>
          </div>
        </dl>

        {/* Why the confidence is what it is. */}
        <div className="inf__signals">
          <Signal
            label="Completeness"
            value={q.completeness}
            hint="How much of the reference was filled in"
          />
          <Signal
            label="Coherence"
            value={coherence.score}
            kind={problems.length ? 'reject' : 'approve'}
            hint="Whether the four figures describe one loan"
          />
          <Signal
            label="Depth"
            value={q.depth}
            hint="Length of the lending relationship"
          />
        </div>

        {problems.length ? (
          <ul className="inf__problems">
            {problems.map((p) => (
              <li key={p.code} className="inf__problem">
                <Tag kind="reject">{p.code}</Tag>
                <span>{p.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {/* What it actually did to the file. This is the part that matters. */}
        <footer className="inf__effect">
          {informal.applicable ? (
            informal.corroborated ? (
              <p>
                <Tag kind="approve">Corroborated</Tag> The repayment matches{' '}
                <em>{informal.matched_debit?.label}</em> in the bank statement, so it is
                counted once in the obligation total — not twice.
              </p>
            ) : (
              <p>
                <Tag kind="refer">Undisclosed</Tag> No bank debit matches this repayment,
                so the engine added <strong className="tnum">{inr(informal.added)}</strong>{' '}
                to existing obligations.
              </p>
            )
          ) : (
            <p>
              <Tag kind="idle">Settled</Tag> Nothing is outstanding, so this adds no
              obligation. It stands as repayment record only.
            </p>
          )}
          <p className="inf__bound t4">
            A reference can raise obligations and evidence conduct. It can never raise
            recognised income or relax a policy limit.
          </p>
        </footer>
      </div>
    </Panel>
  )
}
