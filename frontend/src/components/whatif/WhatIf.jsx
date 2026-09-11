/**
 * "Do not just decline. Find the path to approval."
 *
 * Two instruments over the same frozen evidence: the solver, which asks the
 * engine for the smallest change that reaches the target, and the sandbox,
 * where the officer moves the terms themselves. Both send parameters to the
 * engine and render what comes back — no outcome is predicted here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CButton, DecisionTag, Loading, Panel, Tag } from '@/components/common/ui.jsx'
import { DASH, inr, num, pct } from '@/lib/format'

const DEBOUNCE_MS = 220

const deltaClass = (n) => (n > 0 ? 'delta delta--up' : n < 0 ? 'delta delta--down' : 'delta')

function Lever({ lever, onApply }) {
  if (!lever.feasible) {
    return (
      <li className="lever lever--out">
        <div className="lever__head">
          <h4>{lever.label}</h4>
          <Tag kind="idle">Not available</Tag>
        </div>
        <p className="lever__note">{lever.note}</p>
      </li>
    )
  }

  const m = lever.result.metrics

  return (
    <li className="lever">
      <div className="lever__head">
        <h4>{lever.label}</h4>
        <DecisionTag decision={lever.result.decision} />
      </div>
      <p className="lever__change">{lever.change_text}</p>
      <dl className="lever__metrics">
        <div>
          <dt>EMI</dt>
          <dd className="tnum">{inr(m.emi, { decimals: 2 })}</dd>
        </div>
        <div>
          <dt>FOIR</dt>
          <dd className="tnum">{pct(m.foir)}</dd>
        </div>
        <div>
          <dt>LTV</dt>
          <dd className="tnum">{pct(m.ltv)}</dd>
        </div>
      </dl>
      {lever.note ? <p className="lever__note">{lever.note}</p> : null}
      <CButton variant="ghost" size="sm" onClick={() => onApply(lever.scenario)}>
        Load into sandbox
      </CButton>
    </li>
  )
}

function Slider({ label, value, min, max, step, format, onChange }) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span className="slider__label">{label}</span>
        <span className="slider__value tnum">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider__bounds tnum">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </span>
    </label>
  )
}

export default function WhatIf({ record, policy, onSolve, onSimulate }) {
  const application = record.application
  const segment = policy?.segments?.[application.segment] ?? {}

  const [solution, setSolution] = useState(null)
  const [solving, setSolving] = useState(true)
  const [error, setError] = useState(null)

  const [scenario, setScenario] = useState({
    amount: application.loan_amount,
    tenureMonths: application.tenure_months,
    coApplicantIncome: 0,
  })
  const [sim, setSim] = useState(null)
  const [simulating, setSimulating] = useState(false)
  const touched = useRef(false)

  useEffect(() => {
    let alive = true
    setSolving(true)
    onSolve()
      .then((res) => alive && setSolution(res))
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setSolving(false))
    return () => {
      alive = false
    }
  }, [onSolve])

  useEffect(() => {
    if (!touched.current) return undefined
    let alive = true
    setSimulating(true)
    const t = setTimeout(() => {
      onSimulate(scenario)
        .then((res) => alive && setSim(res))
        .catch((err) => alive && setError(err.message))
        .finally(() => alive && setSimulating(false))
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [scenario, onSimulate])

  const change = useCallback((patch) => {
    touched.current = true
    setScenario((s) => ({ ...s, ...patch }))
  }, [])

  const applyLever = useCallback((next) => {
    touched.current = true
    setScenario({
      amount: next.amount,
      tenureMonths: next.tenureMonths,
      coApplicantIncome: next.coApplicantIncome ?? 0,
    })
  }, [])

  const outcome = sim?.next ?? solution?.base
  const metrics = outcome?.metrics

  return (
    <>
      <Panel title="Path to approval" meta={`Target ${solution?.target ?? 'APPROVE'}`}>
        {solving ? (
          <Loading message="Searching for the smallest change that clears policy" />
        ) : error ? (
          <p className="run__error">{error}</p>
        ) : solution?.already_meets_target ? (
          <p className="whatif__met">
            This file already meets the target. The sandbox below shows what happens if the terms move.
          </p>
        ) : (
          <>
            {solution?.recommended ? (
              <p className="whatif__rec">
                <Tag kind="approve">Recommended</Tag>
                {solution.recommended.change_text}
              </p>
            ) : (
              <p className="whatif__rec">
                <Tag kind="reject">No single change is enough</Tag>
                No individual lever reaches {solution?.target}. Combine terms in the sandbox below.
              </p>
            )}
            <ul className="levers">
              {(solution?.levers ?? []).map((l) => (
                <Lever key={l.id} lever={l} onApply={applyLever} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel title="Scenario sandbox" meta={simulating ? 'Recalculating…' : 'Engine-evaluated'}>
        <div className="sandbox">
          <div className="sandbox__controls">
            <Slider
              label="Requested amount"
              value={scenario.amount}
              min={segment.min_ticket ?? 40000}
              max={segment.max_ticket ?? 480000}
              step={500}
              format={(v) => inr(v)}
              onChange={(amount) => change({ amount })}
            />
            <Slider
              label="Tenure"
              value={scenario.tenureMonths}
              min={segment.tenure_months?.min ?? 12}
              max={segment.tenure_months?.max ?? 60}
              step={1}
              format={(v) => `${num(v)} months`}
              onChange={(tenureMonths) => change({ tenureMonths })}
            />
            <Slider
              label="Co-applicant monthly income"
              value={scenario.coApplicantIncome}
              min={0}
              max={60000}
              step={500}
              format={(v) => inr(v)}
              onChange={(coApplicantIncome) => change({ coApplicantIncome })}
            />
            <p className="sandbox__hint">
              The sandbox sends these terms to the engine. Co-applicant income must itself be evidenced
              and reconciled before any sanction.
            </p>
          </div>

          <div className={`sandbox__out${sim?.changed === 'IMPROVED' ? ' is-improved' : ''}`}>
            <div className="sandbox__verdict">
              <span className="caps t3">Outcome</span>
              <DecisionTag decision={outcome?.decision} />
              {sim ? (
                <span className={`sandbox__moved sandbox__moved--${sim.changed.toLowerCase()}`}>
                  {sim.changed === 'IMPROVED'
                    ? `Improved from ${sim.base.decision}`
                    : sim.changed === 'WORSENED'
                      ? `Worse than ${sim.base.decision}`
                      : `Unchanged from ${sim.base.decision}`}
                </span>
              ) : null}
            </div>

            <dl className="sandbox__metrics">
              <div>
                <dt>EMI</dt>
                <dd className="tnum">{metrics ? inr(metrics.emi, { decimals: 2 }) : DASH}</dd>
                {sim ? <span className={deltaClass(sim.deltas.emi)}>{inr(sim.deltas.emi, { decimals: 2 })}</span> : null}
              </div>
              <div>
                <dt>FOIR</dt>
                <dd className="tnum">{metrics ? pct(metrics.foir) : DASH}</dd>
                {sim ? <span className={deltaClass(sim.deltas.foir)}>{pct(sim.deltas.foir)}</span> : null}
              </div>
              <div>
                <dt>LTV</dt>
                <dd className="tnum">{metrics ? pct(metrics.ltv) : DASH}</dd>
                {sim ? <span className={deltaClass(sim.deltas.ltv)}>{pct(sim.deltas.ltv)}</span> : null}
              </div>
              <div>
                <dt>Total interest</dt>
                <dd className="tnum">{metrics ? inr(metrics.total_interest, { decimals: 2 }) : DASH}</dd>
                {sim ? (
                  <span className={deltaClass(sim.deltas.total_interest)}>
                    {inr(sim.deltas.total_interest, { decimals: 2 })}
                  </span>
                ) : null}
              </div>
            </dl>

            <ul className="sandbox__codes">
              {(outcome?.reason_codes ?? []).map((c) => (
                <li key={c.code}>
                  <span className="mono">{c.code}</span> {c.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>
    </>
  )
}
