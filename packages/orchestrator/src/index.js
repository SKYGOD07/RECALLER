/**
 * RECALLER — underwriting orchestrator.
 *
 * JavaScript port of recaller/orchestrator/pipeline.py.
 * Sequences the stages of a file and records every one of them in the audit
 * ledger. The pipeline is fully resumable and deterministic.
 */

import { ACTORS, appendEvent, createLedger } from '@core/audit.js'
import { APP_STATUS, DECISIONS, ENGINE_VERSION, WORKFLOW_VERSION } from '@core/constants.js'
import { hashValue, makeId } from '@core/hash.js'
import { roundHalfUp } from '@core/money.js'
import { computeCreditMetrics, computeEvidenceStrength } from '@credit-engine/engine.js'
import {
  applyConfidenceGate,
  applyOfficerResolutions,
  extractBundle,
  fixtureAdapter,
  materialise,
} from '@extraction/adapters.js'
import { buildCreditMemo, decisionHeadline } from '@narration/memo.js'
import { evaluatePolicy } from '@policy-engine/engine.js'
import { reconcile, summarise } from '@reconciliation/reconcile.js'
import { simulate, solveMinimumChange } from '@whatif/solver.js'

export const STAGE_PLAN = [
  { id: 'INGEST', label: 'Document ingestion', stage: 'DOCUMENT_INGESTED', actor: ACTORS.SYSTEM },
  { id: 'KYC', label: 'KYC extraction', stage: 'KYC_EXTRACTION', actor: ACTORS.LLM },
  { id: 'BANK', label: 'Bank statement extraction', stage: 'BANK_EXTRACTION', actor: ACTORS.LLM },
  { id: 'PLATFORM', label: 'Platform earnings extraction', stage: 'PLATFORM_EXTRACTION', actor: ACTORS.LLM },
  { id: 'INVOICE', label: 'Invoice extraction', stage: 'INVOICE_EXTRACTION', actor: ACTORS.LLM },
  { id: 'INFORMANT', label: 'Informal-lender reference', stage: 'INFORMANT_ATTESTATION', actor: ACTORS.ENGINE },
  { id: 'VALIDATE', label: 'Evidence validation', stage: 'EVIDENCE_VALIDATION', actor: ACTORS.ENGINE },
  { id: 'RECONCILE', label: 'Reconciliation', stage: 'RECONCILIATION', actor: ACTORS.ENGINE },
  { id: 'GATE', label: 'Confidence gate', stage: 'CONFIDENCE_GATE', actor: ACTORS.ENGINE },
  { id: 'CREDIT', label: 'Credit analysis', stage: 'CREDIT_CALCULATION', actor: ACTORS.ENGINE },
  { id: 'POLICY', label: 'Policy evaluation', stage: 'POLICY_EVALUATION', actor: ACTORS.ENGINE },
  { id: 'DECISION', label: 'Decision', stage: 'DECISION', actor: ACTORS.ENGINE },
  { id: 'MEMO', label: 'Credit memo', stage: 'MEMO_GENERATED', actor: ACTORS.ENGINE },
]

const DECISION_TO_STATUS = {
  [DECISIONS.APPROVE]: APP_STATUS.APPROVED,
  [DECISIONS.REFER]: APP_STATUS.REFERRED,
  [DECISIONS.REJECT]: APP_STATUS.REJECTED,
}

function makeClock(now) {
  if (!now) return () => new Date().toISOString().replace('+00:00', 'Z')
  let tSec
  try {
    tSec = new Date(now).getTime() / 1000
  } catch {
    tSec = Date.now() / 1000
  }
  return () => {
    const iso = new Date(tSec * 1000).toISOString()
    tSec += 1
    return iso
  }
}

function stripPayload(doc) {
  const out = {}
  for (const [k, v] of Object.entries(doc)) {
    if (k !== 'payload' && k !== 'degrade' && !k.startsWith('_')) out[k] = v
  }
  return out
}

function round4(n) {
  try {
    return roundHalfUp(Number(n), 4)
  } catch {
    return 0
  }
}

function createStageRunner(box, clock, onStage) {
  return async function tick(planId, fn) {
    const plan = STAGE_PLAN.find((p) => p.id === planId)
    if (onStage) await onStage({ id: planId, status: 'RUNNING' })

    const startMs = performance.now()
    let out = fn()
    if (out instanceof Promise) out = await out

    const durationMs = Math.round(performance.now() - startMs)
    const summary = typeof out === 'object' && out?.summary ? out.summary : (plan?.label || planId)
    const detail = typeof out === 'object' && out?.detail ? out.detail : {}
    const val = typeof out === 'object' && 'value' in out ? out.value : out

    box.ledger = appendEvent(box.ledger, {
      stage: plan?.stage || planId,
      actor: plan?.actor || ACTORS.SYSTEM,
      summary,
      detail,
      durationMs,
      at: clock(),
    })

    if (onStage) await onStage({ id: planId, status: 'DONE', ms: durationMs })
    return val
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const STAGE_PACING = {
  INGEST: 380, KYC: 900, BANK: 1500, PLATFORM: 850, INVOICE: 780, INFORMANT: 540,
  VALIDATE: 420, RECONCILE: 620, GATE: 340, CREDIT: 520,
  POLICY: 460, DECISION: 380, MEMO: 700,
}

/**
 * Execute the full underwriting pipeline.
 */
export async function runUnderwriting({
  application, documents, policy,
  adapter = fixtureAdapter, resolutions = [], onStage = null, now = null, execution = null,
}) {
  const clock = makeClock(now)
  const docIds = documents.map((d) => d.id)
  const traceId = makeId('TRC', [application.id, policy.version, docIds])
  const box = { ledger: createLedger(traceId) }
  const tick = createStageRunner(box, clock, onStage)

  box.ledger = appendEvent(box.ledger, {
    stage: 'APPLICATION_CREATED',
    actor: ACTORS.OFFICER,
    summary: `Application created for ${application.borrower_name}`,
    detail: { segment: application.segment, amount: application.loan_amount, tenure: application.tenure_months },
    at: clock(),
  })

  // Ingestion
  await tick('INGEST', () => ({
    summary: `${documents.length} documents ingested`,
    detail: { documents: documents.map((d) => ({ id: d.id, type: d.type, filename: d.filename, pages: d.pages })) },
    value: null,
  }))

  // Extraction
  const extraction = await extractBundle({ documents, application, adapter, seed: application.id, policy })

  const groups = [
    ['KYC', ['AADHAAR', 'PAN', 'DRIVING_LICENCE']],
    ['BANK', ['BANK_STATEMENT']],
    ['PLATFORM', ['PLATFORM_EARNINGS']],
    ['INVOICE', ['DEALER_INVOICE']],
    ['INFORMANT', ['INFORMANT_REFERENCE']],
  ]

  for (const [planId, types] of groups) {
    const docs = documents.filter((d) => types.includes(d.type))
    const paths = []
    for (const d of docs) paths.push(...(extraction.byDocument[d.id] || []))
    const docCountStr = `${docs.length} document${docs.length !== 1 ? 's' : ''}`
    const sumText = docs.length
      ? `${paths.length} fields extracted from ${docCountStr}`
      : 'No document of this type supplied'
    await tick(planId, () => ({
      summary: sumText,
      detail: { documents: docs.map((d) => d.filename), fields: paths },
      value: null,
    }))
  }

  // Validate
  const fields = applyOfficerResolutions(extraction.fields, resolutions)
  const stats = extraction.stats || {}
  await tick('VALIDATE', () => ({
    summary: `${Object.keys(fields).length} evidence fields validated`,
    detail: {
      mean_confidence: round4(stats.mean_confidence),
      min_confidence: round4(stats.min_confidence),
      adapter: stats.adapter,
      officer_supplied: resolutions.length,
    },
    value: null,
  }))

  // Provisional metrics & Reconciliation
  const values = materialise(fields)
  const loanRequest = { amount: application.loan_amount, tenureMonths: application.tenure_months, segment: application.segment }

  let provisional = null
  try {
    provisional = computeCreditMetrics({ evidence: values, loanRequest, policy })
  } catch { /* ignore */ }

  const reconciliation = await tick('RECONCILE', () => {
    if (provisional) {
      const r = reconcile({ evidence: values, loanRequest, creditMetrics: provisional, policy })
      return {
        summary: `${r.total} checks — ${r.blocking} blocking, ${r.advisory} advisory`,
        detail: { blocking: r.blocking, advisory: r.advisory, matched: r.matched, codes: r.findings.map((f) => `${f.code}:${f.status}`) },
        value: r,
      }
    }
    const r = summarise([])
    return { summary: '0 checks', detail: {}, value: r }
  })

  // Confidence Gate
  const gate = await tick('GATE', () => {
    const g = applyConfidenceGate(fields, policy)
    const s = g.passed
      ? 'All fields above confidence floor'
      : `${g.held.length} field${g.held.length !== 1 ? 's' : ''} held for officer verification`
    return {
      summary: s,
      detail: {
        held: g.held.map((h) => ({ path: h.path, confidence: round4(h.confidence), floor: h.floor })),
        thresholds: g.thresholds,
      },
      value: g,
    }
  })

  const segLabel = ((policy.segments || {})[application.segment] || {}).label || application.segment
  const base = {
    application: { ...application, segment_label: segLabel },
    documents: documents.map(stripPayload),
    evidence: {
      fields, values, stats,
      extraction_hash: extraction.extraction_hash,
      byDocument: extraction.byDocument,
    },
    reconciliation,
    resolutions,
    policy_version: policy.version,
    policy_hash: hashValue(policy).slice(0, 12),
    engine_version: ENGINE_VERSION,
    execution: execution || { n8n_execution_id: null, workflow_version: WORKFLOW_VERSION },
    stage_plan: STAGE_PLAN,
  }

  if (!gate.passed) {
    box.ledger = appendEvent(box.ledger, {
      stage: 'OFFICER_REVIEW',
      actor: ACTORS.SYSTEM,
      summary: `Execution suspended awaiting officer verification of ${gate.held.length} field${gate.held.length !== 1 ? 's' : ''}`,
      detail: { fields: gate.held.map((h) => h.path) },
      at: clock(),
    })
    return {
      ...base,
      status: APP_STATUS.WAITING_FOR_OFFICER,
      assist: { required: true, queue: gate.held, thresholds: gate.thresholds, resolved: [] },
      credit: null, policyEvaluation: null, decision: null, memo: null,
      // Scored even here — especially here. A held file is exactly the one an
      // officer needs to know the footing of before they answer anything.
      evidence_strength: computeEvidenceStrength({ fields, values, reconciliation, policy }),
      audit: box.ledger,
      checkpoint: {
        created_at: clock(),
        completed_stages: ['INGEST', 'KYC', 'BANK', 'PLATFORM', 'INVOICE', 'INFORMANT', 'VALIDATE', 'RECONCILE', 'GATE'],
        fields, extraction_stats: stats, extraction_hash: extraction.extraction_hash,
        byDocument: extraction.byDocument, reconciliation, ledger: box.ledger,
        seed: application.id,
        hash: hashValue({ fields, reconciliation: reconciliation.findings?.map((f) => f.code) || [] }),
      },
    }
  }

  return finalise({ base, values, reconciliation, loanRequest, policy, box, clock, tick, gate, resolutions })
}

async function finalise({ base, values, reconciliation, loanRequest, policy, box, clock, tick, gate, resolutions }) {
  const credit = await tick('CREDIT', () => {
    const c = computeCreditMetrics({ evidence: values, loanRequest, policy })
    const m = c.metrics
    return {
      summary: `EMI ${m.emi}, FOIR ${m.foir}, LTV ${m.ltv}`,
      detail: { inputs: c.inputs, metrics: m, input_hash: c.input_hash, engine_version: c.engine_version },
      value: c,
    }
  })

  const policyEval = await tick('POLICY', () => {
    const p = evaluatePolicy({
      metrics: credit.metrics, reconciliation, unresolvedLowConfidence: (gate.held || []).length,
      loanRequest, policy,
    })
    const s = p.summary
    return {
      summary: `${s.passed}/${s.total} rules passed, ${s.failed} failed, ${s.referred} referred`,
      detail: { policy_version: p.policy_version, policy_hash: p.policy_hash, rules: p.rules.map((r) => `${r.code}:${r.outcome}`) },
      value: p,
    }
  })

  const decVal = policyEval.decision
  const rcs = policyEval.reason_codes
  const decision = await tick('DECISION', () => ({
    summary: `${decVal} — ${rcs.map((c) => c.code).join(', ')}`,
    detail: { decision: decVal, reason_codes: rcs },
    value: { decision: decVal, reason_codes: rcs },
  }))

  // How much of the file we actually know, scored from the same evidence the
  // decision was made on. It explains the decision's footing; it never alters it.
  const evidenceStrength = computeEvidenceStrength({
    fields: (base.evidence || {}).fields,
    values,
    reconciliation,
    policy,
  })

  const record = {
    ...base,
    status: DECISION_TO_STATUS[decVal] || APP_STATUS.REFERRED,
    assist: { required: false, queue: [], thresholds: gate.thresholds, resolved: resolutions },
    credit, policyEvaluation: policyEval, decision,
    evidence_strength: evidenceStrength,
    audit: box.ledger,
    generated_at: clock(),
    checkpoint: null,
  }

  const memo = await tick('MEMO', () => {
    const m = buildCreditMemo(record)
    return {
      summary: `Credit memo generated (${m.sections.length} sections)`,
      detail: { sections: m.sections.map((s) => s.id) },
      value: m,
    }
  })

  return { ...record, memo, headline: decisionHeadline(record), audit: box.ledger }
}

/**
 * Resume a suspended execution from its checkpoint.
 */
export async function resumeUnderwriting({ record, resolutions, policy, onStage = null, now = null }) {
  const checkpoint = record.checkpoint
  if (!checkpoint) throw new Error('Cannot resume: no checkpoint on this record.')

  const clock = makeClock(now)
  const box = { ledger: checkpoint.ledger }
  const tick = createStageRunner(box, clock, onStage)

  const allResolutions = [...(record.resolutions || []), ...resolutions]
  const fields = applyOfficerResolutions(checkpoint.fields || {}, resolutions)

  box.ledger = appendEvent(box.ledger, {
    stage: 'OFFICER_REVIEW', actor: ACTORS.OFFICER,
    summary: `Officer resolved ${resolutions.length} field${resolutions.length !== 1 ? 's' : ''}`,
    detail: {
      resolutions: resolutions.map((r) => ({
        path: r.path, action: r.action,
        from: (checkpoint.fields || {})[r.path]?.value,
        to: r.action === 'EDIT' ? r.value : (checkpoint.fields || {})[r.path]?.value,
        note: r.note,
      })),
      resumed_from_checkpoint: checkpoint.hash,
    },
    at: clock(),
  })

  const values = materialise(fields)
  const app = record.application || {}
  const loanRequest = { amount: app.loan_amount, tenureMonths: app.tenure_months, segment: app.segment }

  const provisional = computeCreditMetrics({ evidence: values, loanRequest, policy })

  const reconciliation = await tick('RECONCILE', () => {
    const r = reconcile({ evidence: values, loanRequest, creditMetrics: provisional, policy })
    return {
      summary: `${r.total} checks re-run after officer input — ${r.blocking} blocking, ${r.advisory} advisory`,
      detail: { blocking: r.blocking, advisory: r.advisory },
      value: r,
    }
  })

  const gate = {
    passed: true, held: [],
    thresholds: (record.assist || {}).thresholds || (policy.confidence || {}),
  }

  const base = {
    ...record,
    evidence: {
      fields, values, stats: checkpoint.extraction_stats,
      extraction_hash: checkpoint.extraction_hash, byDocument: checkpoint.byDocument,
    },
    reconciliation,
    resolutions: allResolutions,
  }

  return finalise({ base, values, reconciliation, loanRequest, policy, box, clock, tick, gate, resolutions: allResolutions })
}

/**
 * Re-execute a completed application from frozen material.
 */
export async function replay({ record, policy, label = 'Replay with original policy' }) {
  const fields = (record.evidence || {}).fields || {}
  const values = materialise(fields)
  const app = record.application || {}
  const loanRequest = { amount: app.loan_amount, tenureMonths: app.tenure_months, segment: app.segment }

  const provisional = computeCreditMetrics({ evidence: values, loanRequest, policy })
  const rec = reconcile({ evidence: values, loanRequest, creditMetrics: provisional, policy })
  const credit = computeCreditMetrics({ evidence: values, loanRequest, policy })
  const policyEval = evaluatePolicy({
    metrics: credit.metrics, reconciliation: rec, unresolvedLowConfidence: 0, loanRequest, policy,
  })

  const originalCredit = record.credit || {}
  const originalM = originalCredit.metrics || {}
  const newM = credit.metrics || {}

  const identical =
    credit.input_hash === originalCredit.input_hash &&
    policyEval.decision === (record.decision || {}).decision &&
    JSON.stringify(newM) === JSON.stringify(originalM)

  const rows = []
  for (const k of ['emi', 'foir', 'ltv', 'obligations', 'verified_monthly_income']) {
    if (originalM[k] !== newM[k]) rows.push({ field: k, from: originalM[k], to: newM[k] })
  }

  const origCodes = ((record.decision || {}).reason_codes || []).map((c) => c.code)
  const newCodes = (policyEval.reason_codes || []).map((c) => c.code)

  return {
    label, ran_at: new Date().toISOString(), used_llm: false,
    policy_version: policy.version, policy_hash: policyEval.policy_hash,
    identical, credit, reconciliation: rec, policyEvaluation: policyEval,
    decision: { decision: policyEval.decision, reason_codes: policyEval.reason_codes },
    diff: {
      metrics: rows,
      decision: (record.decision || {}).decision === policyEval.decision ? null : { from: (record.decision || {}).decision, to: policyEval.decision },
      reason_codes: { added: newCodes.filter((c) => !origCodes.includes(c)), removed: origCodes.filter((c) => !newCodes.includes(c)) },
    },
  }
}

function withCoApplicant(values, monthlyIncome) {
  const bankEv = values.bank || {}
  const credits = bankEv.monthly_credits || []
  const platformEv = values.platform

  const newVal = { ...values }
  newVal.bank = {
    ...bankEv,
    monthly_credits: credits.map((c) => c + monthlyIncome),
    monthly_cash_deposits: bankEv.monthly_cash_deposits || [],
  }
  if (platformEv) {
    const pNet = platformEv.monthly_net || []
    newVal.platform = { ...platformEv, monthly_net: pNet.map((c) => c + monthlyIncome) }
  }
  return newVal
}

function makeScenarioEvaluator(record, policy) {
  const values = (record.evidence || {}).values || {}
  const segment = (record.application || {}).segment

  return function evaluateScenario(scenario) {
    const loanRequest = { amount: scenario.amount, tenureMonths: scenario.tenureMonths, segment }
    const coAppInc = scenario.coApplicantIncome || 0
    const ev = coAppInc ? withCoApplicant(values, coAppInc) : values

    const credit = computeCreditMetrics({ evidence: ev, loanRequest, policy })
    const rec = reconcile({ evidence: ev, loanRequest, creditMetrics: credit, policy })
    const evaluation = evaluatePolicy({
      metrics: credit.metrics, reconciliation: rec, unresolvedLowConfidence: 0, loanRequest, policy,
    })
    return { decision: evaluation.decision, metrics: credit.metrics, evaluation, reason_codes: evaluation.reason_codes }
  }
}

/**
 * What-if solver entry point.
 */
export function runWhatIf({ record, policy, target = null }) {
  const evaluator = makeScenarioEvaluator(record, policy)
  const app = record.application || {}
  const baseScenario = { amount: app.loan_amount, tenureMonths: app.tenure_months, coApplicantIncome: 0 }
  return solveMinimumChange({
    evaluate: evaluator, baseScenario, policy,
    segment: app.segment || 'EV_2W',
    ...(target ? { target } : {}),
  })
}

/**
 * Free-form simulation entry point.
 */
export function runSimulation({ record, policy, scenario }) {
  const evaluator = makeScenarioEvaluator(record, policy)
  const app = record.application || {}
  const baseScenario = { amount: app.loan_amount, tenureMonths: app.tenure_months, coApplicantIncome: 0 }
  return simulate({ evaluate: evaluator, baseScenario, scenario })
}

export { replay as replayRun, resumeUnderwriting as resumeRun }
