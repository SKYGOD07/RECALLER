/**
 * RECALLER — policy engine.
 *
 * JavaScript port of recaller/policy_engine/engine.py.
 * Consumes deterministic credit metrics plus reconciliation and confidence
 * state, walks the configured rule set, and returns a verdict with reason
 * codes. The engine holds no thresholds of its own: every number it compares
 * against comes out of the policy document.
 */

import { DECISIONS } from '@core/constants.js'
import { hashValue, shortHash } from '@core/hash.js'

const OUTCOME = Object.freeze({
  PASS: 'PASS',
  REFER: 'REFER',
  FAIL: 'FAIL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
})

function inBand(value, band) {
  if (!band || band.length < 2) return false
  return band[0] <= value && value <= band[1]
}

function fmt(v) {
  if (typeof v !== 'number') return String(v)
  if (Number.isInteger(v)) return String(v)
  return parseFloat(v.toFixed(4)).toString()
}

function evaluateRule(rule, ctx) {
  const metrics = ctx.metrics || {}
  const segment = ctx.segment || {}
  const metricKey = rule.metric
  const actual = metrics[metricKey]

  const shell = {
    code: rule.code,
    label: rule.label,
    metric: metricKey,
    severity: rule.severity,
    rationale: rule.rationale,
    operator: rule.operator,
  }

  if (actual == null) {
    return {
      ...shell,
      outcome: OUTCOME.NOT_APPLICABLE,
      actual: null,
      threshold: rule.threshold,
      reason: null,
      detail: 'Metric unavailable for this application.',
    }
  }

  const op = rule.operator
  let threshold = rule.threshold
  const referBand = rule.refer_band
  let outcome, detail

  if (op === 'lte') {
    if (actual <= threshold) outcome = OUTCOME.PASS
    else if (inBand(actual, referBand)) outcome = OUTCOME.REFER
    else outcome = OUTCOME.FAIL
    const sign = actual <= threshold ? '≤' : '>'
    detail = `${fmt(actual)} ${sign} ${fmt(threshold)}`
  } else if (op === 'gte') {
    if (actual >= threshold) outcome = OUTCOME.PASS
    else if (inBand(actual, referBand)) outcome = OUTCOME.REFER
    else outcome = OUTCOME.FAIL
    const sign = actual >= threshold ? '≥' : '<'
    detail = `${fmt(actual)} ${sign} ${fmt(threshold)}`
  } else if (op === 'within_segment_ticket') {
    const minTicket = segment.min_ticket || 0
    const maxTicket = segment.max_ticket || 0
    threshold = { min: minTicket, max: maxTicket }
    outcome = minTicket <= actual && actual <= maxTicket ? OUTCOME.PASS : OUTCOME.FAIL
    detail = `${fmt(actual)} within ${fmt(minTicket)}–${fmt(maxTicket)}`
  } else if (op === 'within_segment_tenure') {
    const tMin = (segment.tenure_months || {}).min || 0
    const tMax = (segment.tenure_months || {}).max || 0
    threshold = { min: tMin, max: tMax }
    outcome = tMin <= actual && actual <= tMax ? OUTCOME.PASS : OUTCOME.FAIL
    detail = `${actual}m within ${tMin}–${tMax}m`
  } else {
    throw new Error(`Unsupported policy operator: ${op}`)
  }

  let reason
  if (outcome === OUTCOME.PASS) reason = rule.pass_reason
  else if (outcome === OUTCOME.REFER) reason = rule.refer_reason
  else reason = rule.reject_reason || rule.refer_reason

  return { ...shell, outcome, actual, threshold, reason, detail }
}

/**
 * Run the full policy against credit metrics and reconciliation state.
 */
export function evaluatePolicy({ metrics, reconciliation, unresolvedLowConfidence = 0, loanRequest, policy }) {
  const segmentCode = loanRequest.segment
  const segment = (policy.segments || {})[segmentCode]
  if (!segment) throw new Error(`Unknown asset segment: ${segmentCode}`)

  const bag = {
    ...metrics,
    blocking_finding_count: (reconciliation || {}).blocking || 0,
    advisory_finding_count: (reconciliation || {}).advisory || 0,
    unresolved_low_confidence_count: unresolvedLowConfidence,
  }

  const results = (policy.rules || []).map((rule) => evaluateRule(rule, { metrics: bag, segment }))

  const hardFails = results.filter(
    (r) => r.outcome === OUTCOME.FAIL && r.severity === 'BLOCKING' && r.reason && r.reason.startsWith('R')
  )
  const advisoryFails = results.filter(
    (r) => r.outcome === OUTCOME.FAIL && r.severity === 'ADVISORY'
  )
  const refers = results.filter((r) => r.outcome === OUTCOME.REFER)

  const reasonCodes = []

  let decision
  if (hardFails.length > 0) {
    decision = DECISIONS.REJECT
    for (const r of hardFails) if (r.reason) reasonCodes.push(r.reason)
    for (const r of refers) if (r.reason) reasonCodes.push(r.reason)
  } else if (refers.length > 0 || advisoryFails.length > 0 || unresolvedLowConfidence > 0) {
    decision = DECISIONS.REFER
    for (const r of refers) if (r.reason) reasonCodes.push(r.reason)
    for (const r of advisoryFails) if (r.reason) reasonCodes.push(r.reason)
    if (unresolvedLowConfidence > 0 && !reasonCodes.includes('F01')) reasonCodes.push('F01')
  } else {
    decision = DECISIONS.APPROVE
    for (const r of results) if (r.outcome === OUTCOME.PASS && r.reason) reasonCodes.push(r.reason)
  }

  const uniqueCodes = [...new Set(reasonCodes)].sort()
  const policyReasonDefs = policy.reason_codes || {}

  return {
    decision,
    reason_codes: uniqueCodes.map((code) => ({ code, text: policyReasonDefs[code] || code })),
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
  }
}

export { OUTCOME }
