/**
 * The decision. Every number on this screen is read straight out of the
 * record the engine returned — the component formats, and does nothing else.
 */

import { DecisionTag, LimitBar, Metric, decisionKind } from '@/components/common/ui.jsx'
import { inr, num, pct } from '@/lib/format'

const VERDICT_COPY = {
  APPROVE: 'Within policy',
  REFER: 'Officer judgement required',
  REJECT: 'Breaches a binding rule',
}

const codeKind = (code) => (code.startsWith('A') ? 'approve' : code.startsWith('R') ? 'reject' : 'refer')

export default function DecisionHero({ record, policy }) {
  const decision = record.decision?.decision
  const kind = decisionKind(decision)
  const m = record.credit.metrics
  const inputs = record.credit.inputs

  const ruleThreshold = (code) => policy?.rules?.find((r) => r.code === code)?.threshold ?? null
  const foirCeiling = ruleThreshold('P-FOIR-01')
  const ltvCeiling = ruleThreshold('P-LTV-01')

  return (
    <section className={`dhero dhero--${kind}`}>
      <div className="dhero__glow" aria-hidden="true" />

      <header className="dhero__head">
        <div className="dhero__verdict">
          <DecisionTag decision={decision} />
          <p className="caps t3">{VERDICT_COPY[decision] ?? 'Decision'}</p>
          <h2 className="dhero__amount tnum">{inr(m.loan_amount)}</h2>
          <p className="dhero__terms tnum">
            {num(m.tenure_months)} months · {num(inputs.rate_annual_pct, 1)}% p.a. reducing ·{' '}
            {inr(m.emi, { decimals: 2 })} per month
          </p>
        </div>

        <p className="dhero__headline">{record.headline}</p>
      </header>

      <div className="dhero__metrics">
        <Metric label="EMI" value={inr(m.emi, { decimals: 2 })} sub="Deterministic · reducing balance" kind={kind} size="lg" />

        <div className="metric metric--lg">
          <span className="metric__label">FOIR</span>
          <strong className="metric__value tnum">{pct(m.foir)}</strong>
          <LimitBar
            value={m.foir}
            limit={foirCeiling}
            kind={kind}
            label={`FOIR ${pct(m.foir)} against a ${pct(foirCeiling, 0)} ceiling`}
          />
          <span className="metric__sub tnum">Policy ceiling {pct(foirCeiling, 0)}</span>
        </div>

        <div className="metric metric--lg">
          <span className="metric__label">LTV</span>
          <strong className="metric__value tnum">{pct(m.ltv)}</strong>
          <LimitBar
            value={m.ltv}
            limit={ltvCeiling}
            kind={kind}
            label={`LTV ${pct(m.ltv)} against a ${pct(ltvCeiling, 0)} ceiling`}
          />
          <span className="metric__sub tnum">Policy ceiling {pct(ltvCeiling, 0)}</span>
        </div>

        <Metric
          label="Verified income"
          value={inr(m.verified_monthly_income, { decimals: 2 })}
          sub={`${num(m.income_months_observed)} months observed`}
          size="lg"
        />
        <Metric
          label="Residual after EMI"
          value={inr(m.disposable_income, { decimals: 2 })}
          sub={`Obligations ${inr(m.obligations, { decimals: 2 })}`}
          size="lg"
        />
      </div>

      <ul className="dhero__codes">
        {(record.decision?.reason_codes ?? []).map((c) => (
          <li key={c.code} className={`rcode rcode--${codeKind(c.code)}`}>
            <span className="rcode__code mono">{c.code}</span>
            <span className="rcode__text">{c.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
