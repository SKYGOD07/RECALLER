/**
 * RECALLER — policy engine.
 *
 * Consumes deterministic credit metrics plus reconciliation and confidence
 * state, walks the configured rule set, and returns a verdict with reason
 * codes. The engine holds no thresholds of its own: every number it compares
 * against comes out of the policy document, which is versioned and hashed.
 */

import { hashValue, shortHash } from '../../core/src/hash.js';
import { DECISIONS } from '../../core/src/constants.js';

const OUTCOME = { PASS: 'PASS', REFER: 'REFER', FAIL: 'FAIL', NOT_APPLICABLE: 'NOT_APPLICABLE' };
export { OUTCOME };

/**
 * Evaluate one rule against the metric bag.
 * Returns { code, label, outcome, actual, threshold, reason, severity }.
 */
function evaluateRule(rule, ctx) {
  const { metrics, segment } = ctx;
  const actual = metrics[rule.metric];

  // A metric the bundle could not produce is reported, never silently passed.
  if (actual === null || actual === undefined) {
    return {
      ...ruleShell(rule),
      outcome: OUTCOME.NOT_APPLICABLE,
      actual: null,
      threshold: rule.threshold,
      reason: null,
      detail: 'Metric unavailable for this application.',
    };
  }

  let outcome;
  let threshold = rule.threshold;
  let detail = '';

  switch (rule.operator) {
    case 'lte': {
      threshold = rule.threshold;
      if (actual <= rule.threshold) outcome = OUTCOME.PASS;
      else if (inBand(actual, rule.refer_band)) outcome = OUTCOME.REFER;
      else outcome = OUTCOME.FAIL;
      detail = `${fmt(actual)} ${actual <= rule.threshold ? '≤' : '>'} ${fmt(rule.threshold)}`;
      break;
    }
    case 'gte': {
      threshold = rule.threshold;
      if (actual >= rule.threshold) outcome = OUTCOME.PASS;
      else if (inBand(actual, rule.refer_band)) outcome = OUTCOME.REFER;
      else outcome = OUTCOME.FAIL;
      detail = `${fmt(actual)} ${actual >= rule.threshold ? '≥' : '<'} ${fmt(rule.threshold)}`;
      break;
    }
    case 'within_segment_ticket': {
      threshold = { min: segment.min_ticket, max: segment.max_ticket };
      outcome = actual >= segment.min_ticket && actual <= segment.max_ticket ? OUTCOME.PASS : OUTCOME.FAIL;
      detail = `${fmt(actual)} within ${fmt(segment.min_ticket)}–${fmt(segment.max_ticket)}`;
      break;
    }
    case 'within_segment_tenure': {
      threshold = { min: segment.tenure_months.min, max: segment.tenure_months.max };
      outcome =
        actual >= segment.tenure_months.min && actual <= segment.tenure_months.max
          ? OUTCOME.PASS
          : OUTCOME.FAIL;
      detail = `${actual}m within ${segment.tenure_months.min}–${segment.tenure_months.max}m`;
      break;
    }
    default:
      throw new Error(`Unsupported policy operator: ${rule.operator}`);
  }

  const reason =
    outcome === OUTCOME.PASS
      ? rule.pass_reason
      : outcome === OUTCOME.REFER
        ? rule.refer_reason
        : rule.reject_reason ?? rule.refer_reason;

  return { ...ruleShell(rule), outcome, actual, threshold, reason: reason ?? null, detail };
}

function ruleShell(rule) {
  return {
    code: rule.code,
    label: rule.label,
    metric: rule.metric,
    severity: rule.severity,
    rationale: rule.rationale,
    operator: rule.operator,
  };
}

function inBand(value, band) {
  if (!band) return false;
  const [lo, hi] = band;
  return value >= lo && value <= hi;
}

function fmt(v) {
  if (typeof v !== 'number') return String(v);
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
}

/**
 * Run the full policy.
 *
 * Precedence, in order:
 *   1. Any BLOCKING rule that FAILs with a reject reason  → REJECT
 *   2. Any unresolved low-confidence critical field       → REFER
 *   3. Any rule in its referral band                      → REFER
 *   4. Otherwise                                          → APPROVE
 *
 * An ADVISORY rule can never reject on its own; it can only refer.
 *
 * @param {object} args
 * @param {object} args.metrics deterministic metrics from the credit engine
 * @param {object} args.reconciliation { blocking, advisory, findings }
 * @param {number} args.unresolvedLowConfidence count of ungated fields
 * @param {object} args.loanRequest
 * @param {object} args.policy
 */
export function evaluatePolicy({ metrics, reconciliation, unresolvedLowConfidence = 0, loanRequest, policy }) {
  const segment = policy.segments[loanRequest.segment];
  if (!segment) throw new Error(`Unknown asset segment: ${loanRequest.segment}`);

  const bag = {
    ...metrics,
    blocking_finding_count: reconciliation?.blocking ?? 0,
    advisory_finding_count: reconciliation?.advisory ?? 0,
    unresolved_low_confidence_count: unresolvedLowConfidence,
  };

  const results = policy.rules.map((rule) => evaluateRule(rule, { metrics: bag, segment }));

  const hardFails = results.filter(
    (r) => r.outcome === OUTCOME.FAIL && r.severity === 'BLOCKING' && r.reason && r.reason.startsWith('R'),
  );
  const advisoryFails = results.filter((r) => r.outcome === OUTCOME.FAIL && r.severity === 'ADVISORY');
  const refers = results.filter((r) => r.outcome === OUTCOME.REFER);

  let decision;
  const reasonCodes = [];

  if (hardFails.length) {
    decision = DECISIONS.REJECT;
    hardFails.forEach((r) => reasonCodes.push(r.reason));
    // A rejected file still reports what it would have been referred for.
    refers.forEach((r) => r.reason && reasonCodes.push(r.reason));
  } else if (refers.length || advisoryFails.length || unresolvedLowConfidence > 0) {
    decision = DECISIONS.REFER;
    refers.forEach((r) => r.reason && reasonCodes.push(r.reason));
    advisoryFails.forEach((r) => r.reason && reasonCodes.push(r.reason));
    if (unresolvedLowConfidence > 0 && !reasonCodes.includes('F01')) reasonCodes.push('F01');
  } else {
    decision = DECISIONS.APPROVE;
    results
      .filter((r) => r.outcome === OUTCOME.PASS && r.reason)
      .forEach((r) => reasonCodes.push(r.reason));
  }

  const unique = [...new Set(reasonCodes)].sort();

  return {
    decision,
    reason_codes: unique.map((code) => ({ code, text: policy.reason_codes[code] ?? code })),
    rules: results,
    summary: {
      passed: results.filter((r) => r.outcome === OUTCOME.PASS).length,
      referred: refers.length,
      failed: results.filter((r) => r.outcome === OUTCOME.FAIL).length,
      not_applicable: results.filter((r) => r.outcome === OUTCOME.NOT_APPLICABLE).length,
      total: results.length,
    },
    policy_version: policy.version,
    policy_id: policy.policy_id,
    policy_effective_date: policy.effective_date,
    policy_hash: shortHash(policy),
    evaluated_hash: hashValue({ bag, version: policy.version }),
  };
}

/** Rules the UI should foreground for a given decision — the ones that decided it. */
export function decisiveRules(evaluation) {
  if (evaluation.decision === 'APPROVE') return evaluation.rules.filter((r) => r.outcome === OUTCOME.PASS);
  return evaluation.rules.filter((r) => r.outcome === OUTCOME.FAIL || r.outcome === OUTCOME.REFER);
}
