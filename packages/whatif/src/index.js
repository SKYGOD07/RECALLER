/**
 * RECALLER — what-if solver.
 *
 * Answers the question a loan officer actually asks at the counter: "what is
 * the smallest change that turns this into a yes?"
 *
 * The solver does not guess and does not interpolate a decision. It re-runs the
 * complete deterministic pipeline — credit engine, then policy engine — for
 * every candidate scenario, and reports the minimum change that produces a
 * better verdict. Because the pipeline is pure, the answer is exact and
 * reproducible, not an estimate.
 */

import { round } from '../../core/src/money.js';
import { DECISIONS } from '../../core/src/constants.js';

const RANK = { REJECT: 0, REFER: 1, APPROVE: 2 };

/** Is `candidate` a strictly better verdict than `base`? */
function isBetter(candidate, base) {
  return RANK[candidate] > RANK[base];
}

/**
 * @param {object} args
 * @param {(scenario:object)=>object} args.evaluate  runs the full pipeline, returns { decision, metrics, evaluation }
 * @param {object} args.baseScenario  { amount, tenureMonths, coApplicantIncome }
 * @param {object} args.policy
 * @param {string} args.segment
 * @param {string} [args.target]      verdict to reach; defaults to APPROVE
 */
export function solveMinimumChange({ evaluate, baseScenario, policy, segment, target = DECISIONS.APPROVE }) {
  const seg = policy.segments[segment];
  const base = evaluate(baseScenario);
  const levers = [];

  if (RANK[base.decision] >= RANK[target]) {
    return {
      base,
      already_meets_target: true,
      target,
      levers: [],
      recommended: null,
    };
  }

  levers.push(solveAmount({ evaluate, baseScenario, seg, target }));
  levers.push(solveTenure({ evaluate, baseScenario, seg, target }));
  levers.push(solveCoApplicant({ evaluate, baseScenario, target }));

  const feasible = levers.filter((l) => l.feasible);
  // Prefer the lever that disturbs the borrower's original request least.
  feasible.sort((a, b) => a.disruption - b.disruption);

  return {
    base,
    already_meets_target: false,
    target,
    levers,
    recommended: feasible[0] ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Lever 1 — reduce the ticket size.
 * Lower principal lowers both EMI (so FOIR) and LTV monotonically, so the
 * feasible region is a prefix and binary search finds its exact edge.
 * ------------------------------------------------------------------ */
function solveAmount({ evaluate, baseScenario, seg, target }) {
  const original = baseScenario.amount;
  const step = 500; // sanction granularity — lenders do not disburse odd rupees

  let lo = seg.min_ticket;
  let hi = original;

  const at = (amt) => evaluate({ ...baseScenario, amount: amt });

  if (!meets(at(lo), target)) {
    return lever('LOAN_AMOUNT', 'Reduce loan amount', false, {
      note: `Even at the product floor of ₹${seg.min_ticket.toLocaleString('en-IN')} this file does not reach ${target}.`,
    });
  }

  // Largest amount (on the step grid) that still meets the target.
  lo = Math.ceil(lo / step) * step;
  hi = Math.floor(hi / step) * step;
  let best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2 / step) * step;
    if (meets(at(mid), target)) {
      best = mid;
      lo = mid + step;
    } else {
      hi = mid - step;
    }
  }

  const result = at(best);
  const delta = round(original - best, 2);
  return lever('LOAN_AMOUNT', 'Reduce loan amount', true, {
    from: original,
    to: best,
    delta,
    delta_pct: round(delta / original, 4),
    unit: 'money',
    change_text: `Reduce the sanctioned amount by ₹${delta.toLocaleString('en-IN')} to ₹${best.toLocaleString('en-IN')}`,
    scenario: { ...baseScenario, amount: best },
    result,
    disruption: delta / original,
  });
}

/* ------------------------------------------------------------------ *
 * Lever 2 — extend the tenure.
 * Longer tenure lowers EMI but raises age-at-maturity and total interest, so
 * the feasible region is not necessarily contiguous. The band is at most a few
 * dozen months, so every candidate is evaluated exactly.
 * ------------------------------------------------------------------ */
function solveTenure({ evaluate, baseScenario, seg, target }) {
  const original = baseScenario.tenureMonths;
  for (let t = original + 1; t <= seg.tenure_months.max; t += 1) {
    const scenario = { ...baseScenario, tenureMonths: t };
    const result = evaluate(scenario);
    if (meets(result, target)) {
      return lever('TENURE', 'Extend tenure', true, {
        from: original,
        to: t,
        delta: t - original,
        unit: 'months',
        change_text: `Extend the tenure by ${t - original} month${t - original === 1 ? '' : 's'} to ${t} months`,
        scenario,
        result,
        disruption: (t - original) / seg.tenure_months.max,
        note: `Total interest rises to ₹${result.metrics.total_interest.toLocaleString('en-IN')}.`,
      });
    }
  }
  return lever('TENURE', 'Extend tenure', false, {
    note: `No tenure up to the product maximum of ${seg.tenure_months.max} months reaches ${target}.`,
  });
}

/* ------------------------------------------------------------------ *
 * Lever 3 — add a co-applicant.
 * Added verified income raises the denominator of FOIR monotonically, so the
 * feasible region is a suffix; binary search on ₹500 granularity.
 * ------------------------------------------------------------------ */
function solveCoApplicant({ evaluate, baseScenario, target }) {
  const step = 500;
  const cap = 200000;
  const at = (inc) => evaluate({ ...baseScenario, coApplicantIncome: inc });

  if (!meets(at(cap), target)) {
    return lever('CO_APPLICANT', 'Add a co-applicant', false, {
      note: 'Additional income alone does not clear this file — the blocker is not affordability.',
    });
  }

  let lo = 0;
  let hi = cap;
  let best = cap;
  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2 / step) * step;
    if (meets(at(mid), target)) {
      best = mid;
      hi = mid - step;
    } else {
      lo = mid + step;
    }
    if (hi < lo) break;
  }

  const scenario = { ...baseScenario, coApplicantIncome: best };
  return lever('CO_APPLICANT', 'Add a co-applicant', true, {
    from: baseScenario.coApplicantIncome ?? 0,
    to: best,
    delta: best - (baseScenario.coApplicantIncome ?? 0),
    unit: 'money',
    change_text: `Add a co-applicant with at least ₹${best.toLocaleString('en-IN')} verified monthly income`,
    scenario,
    result: at(best),
    disruption: 0.5 + best / cap, // adding a person is structurally more disruptive than repricing
    note: 'Co-applicant income must itself be evidenced and reconciled before sanction.',
  });
}

function meets(result, target) {
  return RANK[result.decision] >= RANK[target];
}

function lever(id, label, feasible, extra) {
  return { id, label, feasible, disruption: feasible ? extra.disruption ?? 1 : Infinity, ...extra };
}

/**
 * Free-form simulation for the sandbox sliders: evaluate one explicit scenario
 * and describe how it moved relative to the base.
 */
export function simulate({ evaluate, baseScenario, scenario }) {
  const base = evaluate(baseScenario);
  const next = evaluate({ ...baseScenario, ...scenario });
  return {
    base,
    next,
    changed: isBetter(next.decision, base.decision)
      ? 'IMPROVED'
      : isBetter(base.decision, next.decision)
        ? 'WORSENED'
        : 'UNCHANGED',
    deltas: {
      emi: round(next.metrics.emi - base.metrics.emi, 2),
      foir: round((next.metrics.foir ?? 0) - (base.metrics.foir ?? 0), 4),
      ltv: round((next.metrics.ltv ?? 0) - (base.metrics.ltv ?? 0), 4),
      total_interest: round(next.metrics.total_interest - base.metrics.total_interest, 2),
    },
  };
}
