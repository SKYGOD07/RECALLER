/**
 * RECALLER — narration and credit memo generation.
 *
 * JavaScript port of recaller/narration/memo.py.
 */

import { DECISIONS, FINDING_STATUS } from '@core/constants.js'
import { formatInr, formatPct } from '@core/money.js'

const VERDICT_LEAD = {
  [DECISIONS.APPROVE]: 'The application meets policy on every binding rule and is recommended for sanction.',
  [DECISIONS.REFER]: 'The application cannot be auto-sanctioned and is referred for officer judgement.',
  [DECISIONS.REJECT]: 'The application breaches a binding credit rule and is declined.',
}

function methodLabel(method) {
  if (method === 'LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET') return 'lower-of-bank-run-rate-and-platform-net'
  return String(method).toLowerCase().replace(/_/g, ' ')
}

function incomeNarrative(credit) {
  const b = credit.income_breakdown || {}
  const comp = b.components || {}
  const parts = []
  parts.push(
    `Income is recognised on the ${methodLabel(b.method || '')} basis over a ${b.window_months || 6}-month window; ` +
    `${b.months_observed || 0} month${b.months_observed !== 1 ? 's' : ''} of statement history was available.`
  )
  parts.push(
    `Mean monthly qualifying credits were ${formatInr(comp.mean_monthly_credits || 0, { decimals: 2 })}, ` +
    `of which ${formatInr(comp.mean_monthly_cash || 0, { decimals: 2 })} arrived as cash deposits. ` +
    `Cash was discounted ${formatPct(comp.cash_haircut || 0, 0)} and then capped as a share of recognised income, ` +
    `admitting ${formatInr(comp.cash_admitted || 0, { decimals: 2 })}.`
  )
  if (b.platform_view != null) {
    parts.push(
      `Platform settlements averaged ${formatInr(comp.mean_platform_settlement || 0, { decimals: 2 })} per month; ` +
      `after a ${formatPct(comp.platform_haircut || 0, 0)} haircut for churn the platform view is ${formatInr(b.platform_view || 0, { decimals: 2 })}. ` +
      `The bank view is ${formatInr(b.bank_view || 0, { decimals: 2 })}, and the lower of the two is taken.`
    )
  } else {
    parts.push('No platform earnings statement was supplied, so the bank view stands alone.')
  }
  parts.push(
    `Recognised income is ${formatInr(b.verified_monthly_income || 0, { decimals: 2 })} per month, ` +
    `with month-on-month dispersion of ${formatPct(b.volatility || 0)}.`
  )
  return parts.join(' ')
}

function reconciliationNarrative(rec) {
  const blocking = rec.blocking || 0
  const advisory = rec.advisory || 0
  const total = rec.total || 0
  if (blocking === 0 && advisory === 0) return `All ${total} cross-document checks agree within policy tolerance.`
  const bits = []
  if (blocking) bits.push(`${blocking} blocking contradiction${blocking !== 1 ? 's' : ''}`)
  if (advisory) bits.push(`${advisory} advisory discrepanc${advisory !== 1 ? 'ies' : 'y'}`)
  return (
    `Of ${total} cross-document checks, ${bits.join(' and ')} were raised. ` +
    `Blocking items must be cleared before sanction; advisory items require officer judgement.`
  )
}

function findingDetail(f) {
  const comp = f.comparison || {}
  const left = comp.left || {}
  const right = comp.right || {}
  const status = f.status
  const sim = f.similarity

  if (status === FINDING_STATUS.MATCHED) {
    const simStr = sim != null ? ` (similarity ${formatPct(sim)})` : ''
    return `${left.field} and ${right.field} agree${simStr}.`
  }
  if (sim != null) {
    const tolScore = (f.tolerance || {}).advisory_score || 0
    return (
      `"${left.value}" (${left.source}) against "${right.value}" (${right.source}) — ` +
      `similarity ${formatPct(sim)}, floor ${formatPct(tolScore)}.`
    )
  }
  return (
    `${formatInr(left.value)} (${left.source}) against ${formatInr(right.value)} (${right.source}) — ` +
    `a gap of ${formatInr(f.delta || 0)}, ${formatPct(f.delta_pct || 0)} of the larger figure.`
  )
}

function displayValue(f) {
  const val = f.value
  if (val == null) return '—'
  if (Array.isArray(val)) return `${val.length} values`
  if (f.type === 'money') return formatInr(val, { decimals: 2 })
  if (typeof val === 'object') return `${Object.keys(val).length} entries`
  return String(val)
}

/**
 * One-line decision rationale for the dashboard.
 */
export function decisionHeadline(record) {
  const decision = record.decision || {}
  const decVal = decision.decision
  const credit = record.credit || {}
  const m = credit.metrics || {}

  if (decVal === DECISIONS.APPROVE) {
    return (
      `Affordability holds at ${formatPct(m.foir || 0)} FOIR against a ${formatPct(0.5)} ceiling, ` +
      `with ${formatInr(m.disposable_income || 0)} residual income after the instalment.`
    )
  }

  const rcs = decision.reason_codes || []
  const drivers = rcs.filter((c) => String(c.code || '').startsWith('R')).map((c) => c.text)
  if (drivers.length) return drivers.join('; ') + '.'
  const refers = rcs.filter((c) => String(c.code || '').startsWith('F')).map((c) => c.text)
  if (refers.length) return refers.join('; ') + '.'
  return 'Referred for officer judgement.'
}

/**
 * Build the structured credit memo dictionary.
 */
export function buildCreditMemo(record) {
  const app = record.application || {}
  const evidence = record.evidence || {}
  const reconciliation = record.reconciliation || {}
  const credit = record.credit || {}
  const polEval = record.policyEvaluation || {}
  const decision = record.decision || {}
  const audit = record.audit || {}

  const m = credit.metrics || {}
  const inp = credit.inputs || {}
  const v = evidence.values || {}
  const applicant = v.applicant || {}
  const invoice = v.invoice || {}

  const sections = []
  const decType = decision.decision || DECISIONS.REFER
  let recTail
  if (decType === DECISIONS.APPROVE) {
    recTail = `Sanction ${formatInr(m.loan_amount)} over ${m.tenure_months} months at ${inp.rate_annual_pct}% p.a., repayable at ${formatInr(m.emi, { decimals: 2 })} per month.`
  } else if (decType === DECISIONS.REFER) {
    recTail = 'The items below must be settled by an officer before the file can move.'
  } else {
    recTail = 'The breaches below are not waivable at branch level.'
  }

  sections.push({ id: 'summary', title: 'Recommendation', kind: 'verdict', body: `${VERDICT_LEAD[decType] || ''} ${recTail}` })

  sections.push({
    id: 'borrower', title: 'Borrower and facility', kind: 'table',
    rows: [
      ['Applicant', applicant.name || '—'],
      ['Age', applicant.age != null ? `${applicant.age} years` : '—'],
      ['KYC reference', applicant.id_number || '—'],
      ['PAN', applicant.pan || '—'],
      ['Asset', `${invoice.model || '—'} (${app.segment_label || app.segment || '—'})`],
      ['Dealer', invoice.dealer_name || '—'],
      ['On-road price', m.loan_amount ? formatInr(inp.invoice_on_road_price) : '—'],
      ['Requested facility', formatInr(m.loan_amount)],
      ['Tenure', `${m.tenure_months} months`],
      ['Rate', `${inp.rate_annual_pct}% p.a. reducing`],
    ],
  })

  sections.push({ id: 'income', title: 'Income assessment', kind: 'prose', body: incomeNarrative(credit) })

  sections.push({
    id: 'metrics', title: 'Credit metrics', kind: 'metrics',
    note: 'Computed by the RECALLER calculation engine from gated evidence. No language model contributed to these figures.',
    rows: [
      ['Verified monthly income', formatInr(m.verified_monthly_income, { decimals: 2 })],
      ['Existing obligations', formatInr(m.obligations, { decimals: 2 })],
      ['Proposed EMI', formatInr(m.emi, { decimals: 2 })],
      ['FOIR', formatPct(m.foir)],
      ['LTV', formatPct(m.ltv)],
      ['Residual income after EMI', formatInr(m.disposable_income, { decimals: 2 })],
      ['Total interest over term', formatInr(m.total_interest, { decimals: 2 })],
    ],
  })

  sections.push({
    id: 'reconciliation', title: 'Cross-document reconciliation', kind: 'findings',
    body: reconciliationNarrative(reconciliation),
    items: (reconciliation.findings || []).map((f) => ({ code: f.code, label: f.label, status: f.status, detail: findingDetail(f) })),
  })

  const summary = polEval.summary || {}
  sections.push({
    id: 'policy', title: 'Policy evaluation', kind: 'policy',
    body: `Evaluated against policy ${polEval.policy_id} v${polEval.policy_version} (effective ${polEval.policy_effective_date}, hash ${polEval.policy_hash}). ${summary.passed || 0} of ${summary.total || 0} rules passed, ${summary.referred || 0} referred, ${summary.failed || 0} failed.`,
    items: (polEval.rules || []).filter((r) => r.outcome !== 'NOT_APPLICABLE').map((r) => ({ code: r.code, label: r.label, outcome: r.outcome, detail: r.detail })),
  })

  sections.push({ id: 'reasons', title: 'Reason codes', kind: 'codes', items: decision.reason_codes || [] })

  const interventions = Object.values(evidence.fields || {}).filter((f) => f.provenance === 'OFFICER')
  sections.push({
    id: 'interventions', title: 'Officer interventions', kind: 'interventions',
    body: interventions.length
      ? `${interventions.length} field${interventions.length === 1 ? ' was' : 's were'} confirmed or amended by a human before decisioning.`
      : 'No officer intervention was required; every field cleared the confidence gate automatically.',
    items: interventions.map((f) => ({
      path: f.path, label: f.label, action: (f.officer || {}).action,
      from: (f.superseded || {}).value, to: f.value,
      original_confidence: (f.superseded || {}).confidence,
      by: (f.officer || {}).by, at: (f.officer || {}).at, note: (f.officer || {}).note,
    })),
  })

  sections.push({
    id: 'evidence', title: 'Evidence citations', kind: 'citations',
    items: Object.values(evidence.fields || {}).filter((f) => f.citation).map((f) => ({
      label: f.label, value: displayValue(f), confidence: f.confidence,
      provenance: f.provenance, document: (f.citation || {}).document, page: (f.citation || {}).page,
    })),
  })

  const nowGen = record.generated_at || new Date().toISOString()
  sections.push({
    id: 'provenance', title: 'Provenance', kind: 'table',
    rows: [
      ['Application ID', app.id],
      ['Trace ID', audit.traceId || ''],
      ['Ledger head', audit.head || ''],
      ['Engine version', credit.engine_version || ''],
      ['Policy version', `${polEval.policy_id} v${polEval.policy_version}`],
      ['Policy hash', polEval.policy_hash || ''],
      ['Calculation input hash', credit.input_hash || ''],
      ['Extraction hash', evidence.extraction_hash || ''],
      ['Extraction adapter', (evidence.stats || {}).adapter || ''],
      ['Workflow execution', (record.execution || {}).n8n_execution_id || 'local'],
      ['Workflow version', (record.execution || {}).workflow_version || '—'],
      ['Generated at', nowGen],
    ],
  })

  const borrowerName = applicant.name || app.borrower_name || ''
  return {
    application_id: app.id,
    decision: decision.decision,
    generated_at: nowGen,
    title: `Credit memorandum — ${borrowerName} — ${app.id}`,
    sections,
  }
}
