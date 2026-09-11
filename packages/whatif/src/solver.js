/**
 * RECALLER — what-if solver.
 *
 * JavaScript port of recaller/whatif/solver.py.
 * Answers the question a loan officer asks at the counter: "what is the smallest
 * change that turns this into a yes?" Re-runs the complete deterministic
 * pipeline for candidate scenarios to find exact, reproducible levers.
 */

import { DECISIONS } from '@core/constants.js'
import { roundHalfUp } from '@core/money.js'

const RANK = {
  [DECISIONS.REJECT]: 0,
  [DECISIONS.REFER]: 1,
  [DECISIONS.APPROVE]: 2,
}

function isBetter(candidate, base) {
  return (RANK[candidate] || 0) > (RANK[base] || 0)
}

function meets(result, target) {
  return (RANK[result.decision] || 0) >= (RANK[target] || 0)
}

function lever(leverId, label, feasible, extra = {}) {
  const disruption = feasible ? (extra.disruption ?? 1) : Infinity
  return { id: leverId, label, feasible, disruption, ...extra }
}

function solveAmount(evaluate, baseScenario, seg, target) {
  const original = baseScenario.amount || 0
  const step = 500
  let lo = seg.min_ticket || 0
  let hi = original

  const at = (amt) => evaluate({ ...baseScenario, amount: amt })

  if (!meets(at(lo), target)) {
    return lever('LOAN_AMOUNT', 'Reduce loan amount', false, {
      note: `Even at the product floor of ₹${lo.toLocaleString('en-IN')} this file does not reach ${target}.`,
    })
  }

  lo = Math.ceil(lo / step) * step
  hi = Math.floor(hi / step) * step
  let best = lo
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2 / step) * step
    if (meets(at(mid), target)) {
      best = mid
      lo = mid + step
    } else {
      hi = mid - step
    }
  }

  const result = at(best)
  const delta = roundHalfUp(original - best, 2)
  return lever('LOAN_AMOUNT', 'Reduce loan amount', true, {
    from: original, to: best, delta,
    delta_pct: original ? roundHalfUp(delta / original, 4) : 0,
    unit: 'money',
    change_text: `Reduce the sanctioned amount by ₹${Math.round(delta).toLocaleString('en-IN')} to ₹${Math.round(best).toLocaleString('en-IN')}`,
    scenario: { ...baseScenario, amount: best },
    result,
    disruption: original ? delta / original : 0,
  })
}

function solveTenure(evaluate, baseScenario, seg, target) {
  const original = baseScenario.tenureMonths || 0
  const maxTenure = (seg.tenure_months || {}).max || 60

  for (let t = original + 1; t <= maxTenure; t++) {
    const scenario = { ...baseScenario, tenureMonths: t }
    const result = evaluate(scenario)
    if (meets(result, target)) {
      const delta = t - original
      const m = result.metrics || {}
      return lever('TENURE', 'Extend tenure', true, {
        from: original, to: t, delta, unit: 'months',
        change_text: `Extend the tenure by ${delta} month${delta !== 1 ? 's' : ''} to ${t} months`,
        scenario, result,
        disruption: delta / maxTenure,
        note: `Total interest rises to ₹${Math.round(m.total_interest || 0).toLocaleString('en-IN')}.`,
      })
    }
  }

  return lever('TENURE', 'Extend tenure', false, {
    note: `No tenure up to the product maximum of ${maxTenure} months reaches ${target}.`,
  })
}

function solveCoApplicant(evaluate, baseScenario, target) {
  const step = 500
  const cap = 200000

  const at = (inc) => evaluate({ ...baseScenario, coApplicantIncome: inc })

  if (!meets(at(cap), target)) {
    return lever('CO_APPLICANT', 'Add a co-applicant', false, {
      note: 'Additional income alone does not clear this file — the blocker is not affordability.',
    })
  }

  let lo = 0
  let hi = cap
  let best = cap
  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2 / step) * step
    if (meets(at(mid), target)) {
      best = mid
      hi = mid - step
    } else {
      lo = mid + step
    }
    if (hi < lo) break
  }

  const scenario = { ...baseScenario, coApplicantIncome: best }
  const fromInc = baseScenario.coApplicantIncome || 0
  const delta = best - fromInc

  return lever('CO_APPLICANT', 'Add a co-applicant', true, {
    from: fromInc, to: best, delta, unit: 'money',
    change_text: `Add a co-applicant with at least ₹${Math.round(best).toLocaleString('en-IN')} verified monthly income`,
    scenario, result: at(best),
    disruption: 0.5 + best / cap,
    note: 'Co-applicant income must itself be evidenced and reconciled before sanction.',
  })
}

/**
 * Solve for the smallest lever movement turning a file into target verdict.
 */
export function solveMinimumChange({ evaluate, baseScenario, policy, segment, target = DECISIONS.APPROVE }) {
  const seg = (policy.segments || {})[segment] || {}
  const base = evaluate(baseScenario)

  if ((RANK[base.decision] || 0) >= (RANK[target] || 0)) {
    return { base, already_meets_target: true, target, levers: [], recommended: null }
  }

  const levers = [
    solveAmount(evaluate, baseScenario, seg, target),
    solveTenure(evaluate, baseScenario, seg, target),
    solveCoApplicant(evaluate, baseScenario, target),
  ]

  const feasible = levers.filter((l) => l.feasible).sort((a, b) => a.disruption - b.disruption)

  return {
    base,
    already_meets_target: false,
    target,
    levers,
    recommended: feasible[0] || null,
  }
}

/**
 * Free-form sandbox simulation comparing alternative against base.
 */
export function simulate({ evaluate, baseScenario, scenario }) {
  const base = evaluate(baseScenario)
  const next = evaluate({ ...baseScenario, ...scenario })

  const bDec = base.decision || ''
  const nDec = next.decision || ''

  const changed = isBetter(nDec, bDec) ? 'IMPROVED' : isBetter(bDec, nDec) ? 'WORSENED' : 'UNCHANGED'

  const bM = base.metrics || {}
  const nM = next.metrics || {}

  return {
    base, next, changed,
    deltas: {
      emi: roundHalfUp((nM.emi || 0) - (bM.emi || 0), 2),
      foir: roundHalfUp((nM.foir || 0) - (bM.foir || 0), 4),
      ltv: roundHalfUp((nM.ltv || 0) - (bM.ltv || 0), 4),
      total_interest: roundHalfUp((nM.total_interest || 0) - (bM.total_interest || 0), 2),
    },
  }
}
