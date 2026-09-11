/**
 * "The model never calculates the money."
 *
 * Three deterministic figures with the inputs that produced them, so an officer
 * can see where each number came from without reading a formula.
 */

import { Panel } from '@/components/common/ui.jsx'
import { inr, num, pct } from '@/lib/format'

function Card({ title, result, method, rows }) {
  return (
    <article className="compute">
      <header className="compute__head">
        <span className="caps t3">{title}</span>
        <strong className="compute__result tnum">{result}</strong>
      </header>
      <p className="compute__method">{method}</p>
      <dl className="compute__inputs">
        {rows.map(([k, v]) => (
          <div key={k} className="compute__row">
            <dt>{k}</dt>
            <dd className="tnum">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

export default function ComputePanel({ credit, policy }) {
  const m = credit.metrics
  const i = credit.inputs
  const income = credit.income_breakdown
  const obligations = credit.obligation_breakdown

  const foirCeiling = policy?.rules?.find((r) => r.code === 'P-FOIR-01')?.threshold
  const ltvCeiling = policy?.rules?.find((r) => r.code === 'P-LTV-01')?.threshold

  return (
    <Panel title="Deterministic calculation" meta={`Engine ${credit.engine_version} · ${credit.input_hash}`}>
      <div className="computes">
        <Card
          title="EMI"
          result={inr(m.emi, { decimals: 2 })}
          method="Reducing-balance instalment on the sanctioned amount, at the segment rate, over the requested term."
          rows={[
            ['Sanctioned amount', inr(i.loan_amount)],
            ['Rate', `${num(i.rate_annual_pct, 1)}% p.a.`],
            ['Tenure', `${num(i.tenure_months)} months`],
            ['Total interest', inr(m.total_interest, { decimals: 2 })],
          ]}
        />
        <Card
          title="FOIR"
          result={pct(m.foir)}
          method="Existing obligations plus the proposed instalment, against verified monthly income."
          rows={[
            ['Verified income', inr(i.verified_monthly_income, { decimals: 2 })],
            ['Existing obligations', inr(i.existing_obligations, { decimals: 2 })],
            ['Proposed EMI', inr(m.emi, { decimals: 2 })],
            ['Policy ceiling', pct(foirCeiling, 0)],
          ]}
        />
        <Card
          title="LTV"
          result={pct(m.ltv)}
          method="Sanctioned amount against the lower of invoice on-road price and any independent valuation."
          rows={[
            ['Sanctioned amount', inr(i.loan_amount)],
            ['Invoice on-road price', inr(i.invoice_on_road_price)],
            ['Asset value used', inr(i.asset_value)],
            ['Policy ceiling', pct(ltvCeiling, 0)],
          ]}
        />
      </div>

      <div className="computes__detail">
        <div>
          <p className="caps t3">Income recognition</p>
          <p className="computes__note">
            Method <span className="mono">{income.method}</span> over a {num(income.window_months)}-month
            window, {num(income.months_observed)} months observed.
          </p>
          <dl className="compute__inputs">
            <div className="compute__row">
              <dt>Bank view</dt>
              <dd className="tnum">{inr(income.bank_view, { decimals: 2 })}</dd>
            </div>
            <div className="compute__row">
              <dt>Platform view</dt>
              <dd className="tnum">
                {income.platform_view === null ? 'Not supplied' : inr(income.platform_view, { decimals: 2 })}
              </dd>
            </div>
            <div className="compute__row">
              <dt>Cash admitted after haircut</dt>
              <dd className="tnum">{inr(income.components.cash_admitted, { decimals: 2 })}</dd>
            </div>
            <div className="compute__row">
              <dt>Recognised income</dt>
              <dd className="tnum">{inr(income.verified_monthly_income, { decimals: 2 })}</dd>
            </div>
            <div className="compute__row">
              <dt>Month-on-month volatility</dt>
              <dd className="tnum">{pct(income.volatility)}</dd>
            </div>
          </dl>
        </div>

        <div>
          <p className="caps t3">Existing obligations</p>
          {obligations.items.length ? (
            <dl className="compute__inputs">
              {obligations.items.map((o) => (
                <div key={`${o.label}-${o.amount}`} className="compute__row">
                  <dt>{o.label}</dt>
                  <dd className="tnum">{inr(o.amount, { decimals: 2 })}</dd>
                </div>
              ))}
              <div className="compute__row compute__row--total">
                <dt>Total</dt>
                <dd className="tnum">{inr(obligations.total, { decimals: 2 })}</dd>
              </div>
            </dl>
          ) : (
            <p className="computes__note">No recurring obligation was detected in the statement window.</p>
          )}
        </div>
      </div>
    </Panel>
  )
}
