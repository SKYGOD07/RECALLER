/**
 * Screen 13 — What-if sandbox.
 *
 * Two modes, both exact.
 *
 * The solver answers "what is the smallest change that turns this into a yes?"
 * It does not interpolate: it re-runs the complete deterministic pipeline for
 * every candidate and reports the exact edge of the feasible region — binary
 * search on the levers that are monotone, exhaustive evaluation on the one that
 * is not (tenure, where a longer term lowers the instalment but raises age at
 * maturity).
 *
 * The sliders let the officer explore freely, re-evaluating the same pipeline
 * on every move. Nothing on this screen is estimated.
 */

import { useMemo, useState } from '@/hooks/index.js';
import { solveWhatIf, simulateScenario, POLICY } from '@/services/api.js';
import { Card, DecisionPill, Icon, Metric, PageHead, Empty, ceilingTone } from '@/components/ui.jsx';
import { formatINR, formatPct } from '@core/money.js';

const LEVER_ICON = { LOAN_AMOUNT: 'credit', TENURE: 'audit', CO_APPLICANT: 'assist' };

export default function WhatIf({ application, record }) {
  const segment = POLICY.segments[application.segment];
  const base = record.credit.metrics;

  const solution = useMemo(() => solveWhatIf(application.id, 'APPROVE'), [application.id, record]);

  const [scenario, setScenario] = useState({
    amount: application.loan_amount,
    tenureMonths: application.tenure_months,
    coApplicantIncome: 0,
  });

  const sim = useMemo(() => simulateScenario(application.id, scenario), [application.id, scenario, record]);

  const dirty =
    scenario.amount !== application.loan_amount ||
    scenario.tenureMonths !== application.tenure_months ||
    scenario.coApplicantIncome !== 0;

  function applyLever(lever) {
    setScenario({
      amount: lever.scenario.amount,
      tenureMonths: lever.scenario.tenureMonths,
      coApplicantIncome: lever.scenario.coApplicantIncome ?? 0,
    });
  }

  const foirRule = POLICY.rules.find((r) => r.code === 'P-FOIR-01');
  const ltvRule = POLICY.rules.find((r) => r.code === 'P-LTV-01');

  return (
    <div className="page">
      <PageHead
        eyebrow="Scenario analysis"
        title="What-if sandbox"
        sub="Every scenario below is evaluated by re-running the full deterministic pipeline — credit engine, then policy engine — on the same frozen evidence. Nothing here is an estimate."
        actions={
          dirty && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                setScenario({
                  amount: application.loan_amount,
                  tenureMonths: application.tenure_months,
                  coApplicantIncome: 0,
                })
              }
            >
              Reset to original request
            </button>
          )
        }
      />

      {/* ---- minimum change solver ---------------------------------- */}
      <Card
        title="Minimum change to reach APPROVE"
        eyebrow={solution?.already_meets_target ? 'Already approved' : 'Exact solution'}
        flush
        style={{ marginBottom: 16 }}
      >
        {!solution ? (
          <Empty title="Nothing to solve" />
        ) : solution.already_meets_target ? (
          <div style={{ padding: 16 }}>
            <Empty title="This file already approves">
              The sandbox below still lets you test how much headroom the file has before the decision would turn.
            </Empty>
          </div>
        ) : (
          <div>
            {solution.levers.map((lever) => (
              <div key={lever.id} className="rulerow" style={{ alignItems: 'flex-start', padding: '14px 16px' }}>
                <span
                  className="dropzone__ico"
                  style={{
                    width: 28,
                    height: 28,
                    background: lever.feasible ? 'rgba(198,255,77,0.12)' : 'var(--surface-3)',
                    color: lever.feasible ? 'var(--acc)' : 'var(--text-3)',
                  }}
                >
                  <Icon name={LEVER_ICON[lever.id]} size={14} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="rulerow__label">
                    {lever.label}
                    {solution.recommended?.id === lever.id && (
                      <span className="pill pill--acc" style={{ marginLeft: 9 }}>
                        Least disruptive
                      </span>
                    )}
                  </div>
                  {lever.feasible ? (
                    <>
                      <div className="rulerow__rationale" style={{ color: 'var(--text-2)', fontSize: 12.5 }}>
                        {lever.change_text}
                      </div>
                      {lever.note && <div className="rulerow__rationale">{lever.note}</div>}
                    </>
                  ) : (
                    <div className="rulerow__rationale">{lever.note}</div>
                  )}
                </div>

                {lever.feasible ? (
                  <>
                    <div className="row row--tight" style={{ flexWrap: 'nowrap', marginRight: 4 }}>
                      <Mini label="EMI" value={formatINR(lever.result.metrics.emi)} from={formatINR(base.emi)} />
                      <Mini label="FOIR" value={formatPct(lever.result.metrics.foir)} from={formatPct(base.foir)} />
                      <Mini label="LTV" value={formatPct(lever.result.metrics.ltv)} from={formatPct(base.ltv)} />
                    </div>
                    <div className="row row--tight" style={{ flexWrap: 'nowrap' }}>
                      <DecisionPill decision={lever.result.decision} />
                      <button type="button" className="btn btn--sm" onClick={() => applyLever(lever)}>
                        Load
                      </button>
                    </div>
                  </>
                ) : (
                  <span className="pill pill--neutral">Not feasible</span>
                )}
              </div>
            ))}
            {!solution.recommended && (
              <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)' }} className="sub">
                No single lever reaches APPROVE. The binding constraint is not one this sandbox can move — check the
                decision screen for the rules that failed.
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ---- free exploration --------------------------------------- */}
      <div className="grid grid--sidebar">
        <Card title="Explore" eyebrow="Move a lever, the pipeline re-runs">
          <div className="stack" style={{ gap: 20 }}>
            <Slider
              label="Loan amount"
              value={scenario.amount}
              min={segment.min_ticket}
              max={segment.max_ticket}
              step={500}
              display={formatINR(scenario.amount)}
              original={application.loan_amount}
              originalDisplay={formatINR(application.loan_amount)}
              onChange={(amount) => setScenario((s) => ({ ...s, amount }))}
            />
            <Slider
              label="Tenure"
              value={scenario.tenureMonths}
              min={segment.tenure_months.min}
              max={segment.tenure_months.max}
              step={1}
              display={`${scenario.tenureMonths} months`}
              original={application.tenure_months}
              originalDisplay={`${application.tenure_months} months`}
              onChange={(tenureMonths) => setScenario((s) => ({ ...s, tenureMonths }))}
            />
            <Slider
              label="Co-applicant verified monthly income"
              value={scenario.coApplicantIncome}
              min={0}
              max={100000}
              step={500}
              display={scenario.coApplicantIncome ? formatINR(scenario.coApplicantIncome) : 'No co-applicant'}
              original={0}
              originalDisplay="none"
              onChange={(coApplicantIncome) => setScenario((s) => ({ ...s, coApplicantIncome }))}
            />
          </div>

          {scenario.coApplicantIncome > 0 && (
            <p className="sub" style={{ fontSize: 12, marginTop: 16 }}>
              Co-applicant income is injected through the same recognition rules as the borrower's own — it is not simply
              added to the denominator. In a live file it would have to be evidenced and reconciled before sanction.
            </p>
          )}
        </Card>

        <aside className="stack">
          <Card
            title="Scenario outcome"
            eyebrow={sim ? sim.changed : '—'}
            className={sim?.changed === 'IMPROVED' ? 'fade-in' : undefined}
          >
            {!sim ? (
              <Empty title="No scenario" />
            ) : (
              <>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <div className="eyebrow">As decided</div>
                    <DecisionPill decision={sim.base.decision} />
                  </div>
                  <Icon name="chevron" size={16} className="dim" />
                  <div style={{ textAlign: 'right' }}>
                    <div className="eyebrow">This scenario</div>
                    <DecisionPill decision={sim.next.decision} />
                  </div>
                </div>

                <div className="stack stack--sm">
                  <Delta label="EMI" from={sim.base.metrics.emi} to={sim.next.metrics.emi} money />
                  <Delta label="FOIR" from={sim.base.metrics.foir} to={sim.next.metrics.foir} pct ceiling={foirRule.threshold} />
                  <Delta label="LTV" from={sim.base.metrics.ltv} to={sim.next.metrics.ltv} pct ceiling={ltvRule.threshold} />
                  <Delta label="Total interest" from={sim.base.metrics.total_interest} to={sim.next.metrics.total_interest} money />
                  <Delta
                    label="Residual income"
                    from={sim.base.metrics.disposable_income}
                    to={sim.next.metrics.disposable_income}
                    money
                  />
                </div>

                {sim.next.decision !== sim.base.decision && (
                  <>
                    <div className="divider" />
                    <div className="eyebrow" style={{ marginBottom: 8 }}>
                      Reason codes under this scenario
                    </div>
                    <div className="codelist">
                      {sim.next.reason_codes.map((c) => (
                        <div key={c.code} className={`codeitem codeitem--${c.code[0]}`}>
                          <span className="codeitem__code">{c.code}</span>
                          <span className="codeitem__text">{c.text}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Card>

          <Card title="Scenario metrics" eyebrow="Recomputed">
            {sim && (
              <div className="grid" style={{ gap: 10 }}>
                <Metric
                  label="FOIR"
                  value={formatPct(sim.next.metrics.foir)}
                  sub={`ceiling ${formatPct(foirRule.threshold, 0)}`}
                  tone={ceilingTone(sim.next.metrics.foir, foirRule.threshold, foirRule.refer_band)}
                  fill={sim.next.metrics.foir}
                  cap={foirRule.threshold}
                />
                <Metric
                  label="LTV"
                  value={formatPct(sim.next.metrics.ltv)}
                  sub={`ceiling ${formatPct(ltvRule.threshold, 0)}`}
                  tone={ceilingTone(sim.next.metrics.ltv, ltvRule.threshold, ltvRule.refer_band)}
                  fill={sim.next.metrics.ltv / 1.1}
                  cap={ltvRule.threshold / 1.1}
                />
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, display, original, originalDisplay, onChange }) {
  const changed = value !== original;
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field__label">{label}</span>
        <span className="mono" style={{ fontSize: 13, color: changed ? 'var(--acc)' : 'var(--text)' }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field__hint mono">{typeof min === 'number' && min >= 1000 ? formatINR(min) : min}</span>
        <span className="field__hint">{changed ? `originally ${originalDisplay}` : 'as requested'}</span>
        <span className="field__hint mono">{typeof max === 'number' && max >= 1000 ? formatINR(max) : max}</span>
      </div>
    </div>
  );
}

function Delta({ label, from, to, money, pct, ceiling }) {
  const same = from === to;
  const fmt = (v) => (v === null || v === undefined ? '—' : money ? formatINR(v) : pct ? formatPct(v) : String(v));
  const better = ceiling !== undefined ? to < from : to > from;
  return (
    <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
      <span className="dim">{label}</span>
      <span className="num">
        {same ? (
          fmt(to)
        ) : (
          <>
            <span className="dim" style={{ textDecoration: 'line-through', marginRight: 7 }}>
              {fmt(from)}
            </span>
            <span style={{ color: better ? 'var(--emerald)' : 'var(--amber)' }}>{fmt(to)}</span>
          </>
        )}
      </span>
    </div>
  );
}

function Mini({ label, value, from }) {
  const same = value === from;
  return (
    <div style={{ textAlign: 'right', minWidth: 66 }}>
      <div className="eyebrow" style={{ fontSize: 9 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 12, color: same ? 'var(--text-2)' : 'var(--acc)' }}>
        {value}
      </div>
    </div>
  );
}
