/**
 * Screen 7 — Credit analysis.
 *
 * The money. Every figure on this screen came out of the deterministic credit
 * engine, and the screen shows the inputs beside the outputs so the arithmetic
 * can be checked by hand. The provenance note is not decoration: it is the
 * claim that a language model did not produce any of these numbers, stated
 * where a credit officer will actually read it.
 */

import { useState } from '@/hooks/index.js';
import { Card, Metric, PageHead, Money, Pct, ceilingTone, floorTone, Icon } from '@/components/ui.jsx';
import { POLICY } from '@/services/api.js';
import { formatINR, formatPct } from '@core/money.js';

export default function CreditAnalysis({ record }) {
  const [showSchedule, setShowSchedule] = useState(false);
  const { metrics: m, inputs, income_breakdown: inc, obligation_breakdown: obl, schedule } = record.credit;

  const foirRule = rule('P-FOIR-01');
  const ltvRule = rule('P-LTV-01');
  const incRule = rule('P-INC-01');

  return (
    <div className="page">
      <PageHead
        eyebrow="Deterministic calculation"
        title="Credit analysis"
        sub="Computed by the RECALLER calculation engine from gated evidence. No language model contributed to any figure on this screen."
        actions={
          <span className="pill pill--acc">
            <Icon name="check" size={10} />
            engine {record.credit.engine_version}
          </span>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Metric
          label="Monthly instalment"
          value={formatINR(m.emi, { decimals: 0 })}
          sub={`${m.tenure_months} months at ${inputs.rate_annual_pct}% p.a. reducing`}
          tone="neutral"
        />
        <Metric
          label="FOIR"
          value={formatPct(m.foir)}
          sub={`ceiling ${formatPct(foirRule.threshold, 0)} · refer to ${formatPct(foirRule.refer_band[1], 0)}`}
          tone={ceilingTone(m.foir, foirRule.threshold, foirRule.refer_band)}
          fill={m.foir / (foirRule.refer_band[1] * 1.35)}
          cap={foirRule.threshold / (foirRule.refer_band[1] * 1.35)}
        />
        <Metric
          label="LTV"
          value={formatPct(m.ltv)}
          sub={`ceiling ${formatPct(ltvRule.threshold, 0)} · refer to ${formatPct(ltvRule.refer_band[1], 0)}`}
          tone={ceilingTone(m.ltv, ltvRule.threshold, ltvRule.refer_band)}
          fill={m.ltv / 1.1}
          cap={ltvRule.threshold / 1.1}
        />
        <Metric
          label="Existing obligations"
          value={formatINR(m.obligations, { decimals: 0 })}
          sub={`${obl.items.length} recurring commitment${obl.items.length === 1 ? '' : 's'} detected`}
          tone={obl.items.length ? 'warn' : 'good'}
        />
      </div>

      <div className="grid grid--sidebar">
        <div className="stack">
          <Card
            title="Calculation inputs"
            eyebrow="What the engine was given"
            note="Change any input and every figure below changes with it. The what-if sandbox does exactly that, deterministically."
          >
            <div className="grid grid--2">
              <table className="kv">
                <tbody>
                  <tr>
                    <td>Verified monthly income</td>
                    <td>
                      <Money value={inputs.verified_monthly_income} decimals={2} />
                    </td>
                  </tr>
                  <tr>
                    <td>Existing monthly obligations</td>
                    <td>
                      <Money value={inputs.existing_obligations} decimals={2} />
                    </td>
                  </tr>
                  <tr>
                    <td>Months of income observed</td>
                    <td className="num">{inputs.months_observed}</td>
                  </tr>
                  <tr>
                    <td>Requested amount</td>
                    <td>
                      <Money value={inputs.loan_amount} />
                    </td>
                  </tr>
                </tbody>
              </table>
              <table className="kv">
                <tbody>
                  <tr>
                    <td>Tenure</td>
                    <td className="num">{inputs.tenure_months} months</td>
                  </tr>
                  <tr>
                    <td>Rate</td>
                    <td className="num">{inputs.rate_annual_pct}% p.a.</td>
                  </tr>
                  <tr>
                    <td>Invoice on-road price</td>
                    <td>
                      <Money value={inputs.invoice_on_road_price} />
                    </td>
                  </tr>
                  <tr>
                    <td>Asset value used</td>
                    <td>
                      <Money value={inputs.asset_value} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Income recognition" eyebrow={inc.method.replace(/_/g, ' ').toLowerCase()}>
            <p className="sub" style={{ marginBottom: 14 }}>
              Two independent views of income are built, and the more conservative one is taken. Cash is discounted and
              capped; platform settlements take a haircut for churn.
            </p>
            <div className="grid grid--2">
              <div className="cmpbox">
                <div className="cmpbox__field">Bank view</div>
                <div className="cmpbox__value">{formatINR(inc.bank_view, { decimals: 2 })}</div>
                <div className="cmpbox__src">
                  mean credits {formatINR(inc.components.mean_monthly_credits)} less cash{' '}
                  {formatINR(inc.components.mean_monthly_cash)}, of which {formatINR(inc.components.cash_admitted)}{' '}
                  admitted after a {formatPct(inc.components.cash_haircut, 0)} haircut
                </div>
              </div>
              <div className="cmpbox" style={inc.platform_view !== null && inc.platform_view <= inc.bank_view ? { borderColor: 'rgba(198,255,77,0.35)' } : undefined}>
                <div className="cmpbox__field">Platform view</div>
                <div className="cmpbox__value">
                  {inc.platform_view === null ? '— not supplied' : formatINR(inc.platform_view, { decimals: 2 })}
                </div>
                <div className="cmpbox__src">
                  {inc.platform_view === null
                    ? 'No platform earnings statement in the bundle; the bank view stands alone'
                    : `mean settlement ${formatINR(inc.components.mean_platform_settlement)} less ${formatPct(inc.components.platform_haircut, 0)} churn haircut`}
                </div>
              </div>
            </div>

            <div className="divider" />

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="eyebrow">Recognised income</div>
                <div className="metric__value" style={{ fontSize: 22 }}>
                  {formatINR(inc.verified_monthly_income, { decimals: 2 })}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="eyebrow">Dispersion</div>
                <div
                  className="metric__value"
                  style={{
                    fontSize: 22,
                    color: floorTone(-inc.volatility, -0.35) === 'good' ? 'var(--emerald)' : 'var(--amber)',
                  }}
                >
                  {formatPct(inc.volatility)}
                </div>
                <div className="metric__sub">{inc.months_observed} months observed</div>
              </div>
            </div>

            <div className="divider" />
            <div className="tablewrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Month</th>
                    {record.evidence.values.bank.monthly_credits.map((_, i) => (
                      <th key={i} className="right">
                        M{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="dim">Qualifying credits</td>
                    {record.evidence.values.bank.monthly_credits.map((v, i) => (
                      <td key={i} className="right num">
                        {formatINR(v, { symbol: false })}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="dim">of which cash</td>
                    {(record.evidence.values.bank.monthly_cash_deposits ?? []).map((v, i) => (
                      <td key={i} className="right num dim">
                        {formatINR(v, { symbol: false })}
                      </td>
                    ))}
                  </tr>
                  {record.evidence.values.platform?.monthly_net && (
                    <tr>
                      <td className="dim">Platform settlements</td>
                      {record.evidence.values.platform.monthly_net.map((v, i) => (
                        <td key={i} className="right num">
                          {formatINR(v, { symbol: false })}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Amortisation"
            eyebrow={`${schedule.length} instalments`}
            tools={
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setShowSchedule((s) => !s)}>
                {showSchedule ? 'Hide schedule' : 'Show full schedule'}
              </button>
            }
            flush
          >
            <div style={{ padding: 16 }}>
              <div className="grid grid--3">
                <Metric label="Total payable" value={formatINR(m.total_payable)} sub="principal plus interest" />
                <Metric label="Total interest" value={formatINR(m.total_interest)} sub="over the full term" />
                <Metric
                  label="Residual income"
                  value={formatINR(m.disposable_income)}
                  sub="after obligations and this instalment"
                  tone={m.disposable_income > 0 ? 'good' : 'bad'}
                />
              </div>
            </div>
            {showSchedule && (
              <div className="tablewrap fade-in" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="right">Opening</th>
                      <th className="right">Instalment</th>
                      <th className="right">Interest</th>
                      <th className="right">Principal</th>
                      <th className="right">Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((r) => (
                      <tr key={r.month}>
                        <td className="mono dim">{r.month}</td>
                        <td className="right num">{formatINR(r.opening, { decimals: 2 })}</td>
                        <td className="right num">{formatINR(r.payment, { decimals: 2 })}</td>
                        <td className="right num dim">{formatINR(r.interest, { decimals: 2 })}</td>
                        <td className="right num">{formatINR(r.principal, { decimals: 2 })}</td>
                        <td className="right num">{formatINR(r.closing, { decimals: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="stack">
          <Card title="How each figure was derived" eyebrow="Formulae">
            <Formula
              name="EMI"
              expr="P · r · (1+r)ⁿ / ((1+r)ⁿ − 1)"
              subs={`P = ${formatINR(inputs.loan_amount)},  r = ${inputs.rate_annual_pct}% ÷ 12,  n = ${inputs.tenure_months}`}
              result={formatINR(m.emi, { decimals: 2 })}
            />
            <Formula
              name="FOIR"
              expr="(obligations + EMI) ÷ verified income"
              subs={`(${formatINR(inputs.existing_obligations)} + ${formatINR(m.emi)}) ÷ ${formatINR(inputs.verified_monthly_income)}`}
              result={formatPct(m.foir, 2)}
            />
            <Formula
              name="LTV"
              expr="sanctioned ÷ asset value"
              subs={`${formatINR(inputs.loan_amount)} ÷ ${formatINR(inputs.asset_value)}`}
              result={formatPct(m.ltv, 2)}
            />
          </Card>

          <Card title="Obligations detected" eyebrow={`${obl.items.length} recurring debits`} flush>
            {obl.items.length === 0 ? (
              <div style={{ padding: 16 }} className="sub">
                No recurring loan obligations were found in the statement window.
              </div>
            ) : (
              <div>
                {obl.items.map((o, i) => (
                  <div key={i} className="rulerow">
                    <div style={{ minWidth: 0 }}>
                      <div className="rulerow__label">{o.label}</div>
                      <div className="rulerow__rationale">{o.source}</div>
                    </div>
                    <div className="rulerow__cmp">{formatINR(o.amount)}</div>
                  </div>
                ))}
                <div className="rulerow" style={{ background: 'var(--surface-2)' }}>
                  <div className="rulerow__label t-strong">Total</div>
                  <div className="rulerow__cmp t-strong">{formatINR(obl.total, { decimals: 2 })}</div>
                </div>
              </div>
            )}
          </Card>

          <Card title="Conduct" eyebrow="From the statement">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Average monthly balance</td>
                  <td>
                    <Money value={m.average_monthly_balance} />
                  </td>
                </tr>
                <tr>
                  <td>Returned debits</td>
                  <td className="num" style={{ color: m.bounce_count > 1 ? 'var(--amber)' : undefined }}>
                    {m.bounce_count}
                  </td>
                </tr>
                <tr>
                  <td>Applicant age</td>
                  <td className="num">{m.applicant_age ?? '—'}</td>
                </tr>
                <tr>
                  <td>Age at maturity</td>
                  <td className="num">{m.age_at_maturity ?? '—'}</td>
                </tr>
                <tr>
                  <td>Income floor</td>
                  <td>
                    <Money value={incRule.threshold} />
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Reproducibility" eyebrow="Fingerprints">
            <table className="kv">
              <tbody>
                <tr>
                  <td>Calculation input hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.credit.input_hash.slice(0, 18)}
                  </td>
                </tr>
                <tr>
                  <td>Evidence hash</td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {record.evidence.extraction_hash.slice(0, 18)}
                  </td>
                </tr>
                <tr>
                  <td>Engine</td>
                  <td className="mono">{record.credit.engine_version}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Formula({ name, expr, subs, result }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div className="eyebrow">{name}</div>
      <div className="mono" style={{ fontSize: 12, marginTop: 3 }}>
        {expr}
      </div>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 3, wordBreak: 'break-word' }}>
        {subs}
      </div>
      <div className="mono" style={{ fontSize: 13, marginTop: 4, color: 'var(--acc)' }}>
        = {result}
      </div>
    </div>
  );
}

function rule(code) {
  return POLICY.rules.find((r) => r.code === code);
}
