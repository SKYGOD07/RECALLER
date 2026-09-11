/**
 * RECALLER — underwriting orchestrator.
 *
 * Sequences the stages of a file and records every one of them. This module is
 * deliberately the only place that knows the order of operations, so that n8n,
 * the backend and the replay harness all execute the identical path.
 *
 * The pipeline is resumable. When the confidence gate holds a field back, the
 * run stops and freezes a checkpoint; `resumeUnderwriting` picks the execution
 * up from that checkpoint with the officer's answers folded in, rather than
 * re-running extraction from the beginning.
 */

import { extractBundle, applyConfidenceGate, applyOfficerResolutions, materialise, fixtureAdapter } from '../../extraction/src/index.js';
import { reconcile, summarise } from '../../reconciliation/src/index.js';
import { computeCreditMetrics } from '../../credit-engine/src/index.js';
import { evaluatePolicy } from '../../policy-engine/src/index.js';
import { buildCreditMemo, decisionHeadline } from '../../narration/src/index.js';
import { solveMinimumChange, simulate } from '../../whatif/src/index.js';
import { createLedger, appendEvent, ACTORS } from '../../core/src/audit.js';
import { hashValue, makeId } from '../../core/src/hash.js';
import { APP_STATUS, DECISIONS, ENGINE_VERSION, WORKFLOW_VERSION } from '../../core/src/constants.js';

/** Ordered stage plan the progress view renders. */
export const STAGE_PLAN = [
  { id: 'INGEST', label: 'Document ingestion', stage: 'DOCUMENT_INGESTED', actor: ACTORS.SYSTEM },
  { id: 'KYC', label: 'KYC extraction', stage: 'KYC_EXTRACTION', actor: ACTORS.LLM },
  { id: 'BANK', label: 'Bank statement extraction', stage: 'BANK_EXTRACTION', actor: ACTORS.LLM },
  { id: 'PLATFORM', label: 'Platform earnings extraction', stage: 'PLATFORM_EXTRACTION', actor: ACTORS.LLM },
  { id: 'INVOICE', label: 'Invoice extraction', stage: 'INVOICE_EXTRACTION', actor: ACTORS.LLM },
  { id: 'VALIDATE', label: 'Evidence validation', stage: 'EVIDENCE_VALIDATION', actor: ACTORS.ENGINE },
  { id: 'RECONCILE', label: 'Reconciliation', stage: 'RECONCILIATION', actor: ACTORS.ENGINE },
  { id: 'GATE', label: 'Confidence gate', stage: 'CONFIDENCE_GATE', actor: ACTORS.ENGINE },
  { id: 'CREDIT', label: 'Credit analysis', stage: 'CREDIT_CALCULATION', actor: ACTORS.ENGINE },
  { id: 'POLICY', label: 'Policy evaluation', stage: 'POLICY_EVALUATION', actor: ACTORS.ENGINE },
  { id: 'DECISION', label: 'Decision', stage: 'DECISION', actor: ACTORS.ENGINE },
  { id: 'MEMO', label: 'Credit memo', stage: 'MEMO_GENERATED', actor: ACTORS.ENGINE },
];

const DECISION_TO_STATUS = {
  [DECISIONS.APPROVE]: APP_STATUS.APPROVED,
  [DECISIONS.REFER]: APP_STATUS.REFERRED,
  [DECISIONS.REJECT]: APP_STATUS.REJECTED,
};

/**
 * Run the underwriting pipeline.
 *
 * @param {object} args
 * @param {object} args.application  application header
 * @param {Array}  args.documents    document bundle
 * @param {object} args.policy       parsed policy document
 * @param {object} [args.adapter]    extraction adapter (fixture or LLM)
 * @param {Array}  [args.resolutions] officer answers already known (replay)
 * @param {Function} [args.onStage]  progress callback ({ id, status, ms })
 * @param {string} [args.now]        ISO clock injection, so replay is time-stable
 */
export async function runUnderwriting({
  application,
  documents,
  policy,
  adapter = fixtureAdapter,
  resolutions = [],
  onStage = () => {},
  now = null,
  execution = null,
}) {
  const clock = makeClock(now);
  const traceId = makeId('TRC', [application.id, policy.version, documents.map((d) => d.id)]);
  // The ledger is carried in a box so the terminal half of the pipeline, which
  // runs in `finalise`, appends to the same chain rather than a copy of it.
  const box = { ledger: createLedger(traceId) };
  const tick = createStageRunner(box, clock, onStage);

  box.ledger = appendEvent(box.ledger, {
    stage: 'APPLICATION_CREATED',
    actor: ACTORS.OFFICER,
    summary: `Application created for ${application.borrower_name}`,
    detail: { segment: application.segment, amount: application.loan_amount, tenure: application.tenure_months },
    at: clock(),
  });

  /* ---- ingestion ------------------------------------------------- */
  await tick('INGEST', () => ({
    summary: `${documents.length} documents ingested`,
    detail: { documents: documents.map((d) => ({ id: d.id, type: d.type, filename: d.filename, pages: d.pages })) },
    value: null,
  }));

  /* ---- extraction, one stage per document family ------------------ */
  const extraction = await extractBundle({ documents, application, adapter, seed: application.id });
  const groups = [
    ['KYC', ['AADHAAR', 'PAN', 'DRIVING_LICENCE']],
    ['BANK', ['BANK_STATEMENT']],
    ['PLATFORM', ['PLATFORM_EARNINGS']],
    ['INVOICE', ['DEALER_INVOICE']],
  ];
  for (const [planId, types] of groups) {
    const docs = documents.filter((d) => types.includes(d.type));
    const paths = docs.flatMap((d) => extraction.byDocument[d.id] ?? []);
    // eslint-disable-next-line no-await-in-loop
    await tick(planId, () => ({
      summary: docs.length ? `${paths.length} fields extracted from ${docs.length} document${docs.length === 1 ? '' : 's'}` : 'No document of this type supplied',
      detail: { documents: docs.map((d) => d.filename), fields: paths },
      value: null,
    }));
  }

  /* ---- officer answers already on file (resume / replay) ---------- */
  let fields = applyOfficerResolutions(extraction.fields, resolutions);

  await tick('VALIDATE', () => ({
    summary: `${Object.keys(fields).length} evidence fields validated`,
    detail: {
      mean_confidence: round4(extraction.stats.mean_confidence),
      min_confidence: round4(extraction.stats.min_confidence),
      adapter: extraction.stats.adapter,
      officer_supplied: resolutions.length,
    },
    value: null,
  }));

  /* ---- reconciliation needs verified income, which needs the engine.
         We compute a provisional metric set purely to feed reconciliation;
         the binding figures are recomputed after the gate clears. -------- */
  const values = materialise(fields);
  const loanRequest = {
    amount: application.loan_amount,
    tenureMonths: application.tenure_months,
    segment: application.segment,
  };

  let provisional = null;
  try {
    provisional = computeCreditMetrics({ evidence: values, loanRequest, policy });
  } catch {
    provisional = null;
  }

  const reconciliation = await tick('RECONCILE', () => {
    const r = provisional
      ? reconcile({ evidence: values, loanRequest, creditMetrics: provisional, policy })
      : summarise([]);
    return {
      summary: `${r.total} checks — ${r.blocking} blocking, ${r.advisory} advisory`,
      detail: { blocking: r.blocking, advisory: r.advisory, matched: r.matched, codes: r.findings.map((f) => `${f.code}:${f.status}`) },
      value: r,
    };
  });

  /* ---- confidence gate ------------------------------------------- */
  const gate = await tick('GATE', () => {
    const g = applyConfidenceGate(fields, policy);
    return {
      summary: g.passed ? 'All fields above confidence floor' : `${g.held.length} field${g.held.length === 1 ? '' : 's'} held for officer verification`,
      detail: { held: g.held.map((h) => ({ path: h.path, confidence: round4(h.confidence), floor: h.floor })), thresholds: g.thresholds },
      value: g,
    };
  });

  const base = {
    application: { ...application, segment_label: policy.segments[application.segment]?.label ?? application.segment },
    documents: documents.map(stripPayload),
    evidence: { fields, values, stats: extraction.stats, extraction_hash: extraction.extraction_hash, byDocument: extraction.byDocument },
    reconciliation,
    resolutions,
    policy_version: policy.version,
    policy_hash: hashValue(policy).slice(0, 12),
    engine_version: ENGINE_VERSION,
    execution: execution ?? { n8n_execution_id: null, workflow_version: WORKFLOW_VERSION },
    stage_plan: STAGE_PLAN,
  };

  /* ---- pause for the human, if the gate held anything ------------- */
  if (!gate.passed) {
    box.ledger = appendEvent(box.ledger, {
      stage: 'OFFICER_REVIEW',
      actor: ACTORS.SYSTEM,
      summary: `Execution suspended awaiting officer verification of ${gate.held.length} field${gate.held.length === 1 ? '' : 's'}`,
      detail: { fields: gate.held.map((h) => h.path) },
      at: clock(),
    });

    return {
      ...base,
      status: APP_STATUS.WAITING_FOR_OFFICER,
      assist: { required: true, queue: gate.held, thresholds: gate.thresholds, resolved: [] },
      credit: null,
      policyEvaluation: null,
      decision: null,
      memo: null,
      audit: box.ledger,
      /** Frozen state the resume path rehydrates from — the reason resume is not a restart. */
      checkpoint: {
        created_at: clock(),
        completed_stages: ['INGEST', 'KYC', 'BANK', 'PLATFORM', 'INVOICE', 'VALIDATE', 'RECONCILE', 'GATE'],
        fields,
        extraction_stats: extraction.stats,
        extraction_hash: extraction.extraction_hash,
        byDocument: extraction.byDocument,
        reconciliation,
        ledger: box.ledger,
        seed: application.id,
        hash: hashValue({ fields, reconciliation: reconciliation.findings.map((f) => f.code) }),
      },
    };
  }

  return finalise({ base, values, reconciliation, loanRequest, policy, box, clock, tick, gate, resolutions });
}

/**
 * Resume a suspended execution from its checkpoint.
 *
 * The documents are NOT re-read and the model is NOT re-invoked; the frozen
 * evidence is rehydrated, the officer's answers are folded in, and the pipeline
 * continues at the stage after the gate.
 */
export async function resumeUnderwriting({ record, resolutions, policy, onStage = () => {}, now = null }) {
  if (!record.checkpoint) throw new Error('Cannot resume: no checkpoint on this record.');
  const clock = makeClock(now);
  const box = { ledger: record.checkpoint.ledger };
  const tick = createStageRunner(box, clock, onStage);

  const allResolutions = [...(record.resolutions ?? []), ...resolutions];
  const fields = applyOfficerResolutions(record.checkpoint.fields, resolutions);

  box.ledger = appendEvent(box.ledger, {
    stage: 'OFFICER_REVIEW',
    actor: ACTORS.OFFICER,
    summary: `Officer resolved ${resolutions.length} field${resolutions.length === 1 ? '' : 's'}`,
    detail: {
      resolutions: resolutions.map((r) => ({
        path: r.path,
        action: r.action,
        from: record.checkpoint.fields[r.path]?.value ?? null,
        to: r.action === 'EDIT' ? r.value : record.checkpoint.fields[r.path]?.value ?? null,
        note: r.note ?? null,
      })),
      resumed_from_checkpoint: record.checkpoint.hash,
    },
    at: clock(),
  });

  const values = materialise(fields);
  const loanRequest = {
    amount: record.application.loan_amount,
    tenureMonths: record.application.tenure_months,
    segment: record.application.segment,
  };

  // Reconciliation is re-run: the officer may have corrected a name or an
  // amount that a finding was built on.
  const provisional = computeCreditMetrics({ evidence: values, loanRequest, policy });
  const reconciliation = await tick('RECONCILE', () => {
    const r = reconcile({ evidence: values, loanRequest, creditMetrics: provisional, policy });
    return {
      summary: `${r.total} checks re-run after officer input — ${r.blocking} blocking, ${r.advisory} advisory`,
      detail: { blocking: r.blocking, advisory: r.advisory },
      value: r,
    };
  });

  const gate = { passed: true, held: [], thresholds: record.assist?.thresholds ?? policy.confidence };

  const base = {
    ...record,
    evidence: {
      fields,
      values,
      stats: record.checkpoint.extraction_stats,
      extraction_hash: record.checkpoint.extraction_hash,
      byDocument: record.checkpoint.byDocument,
    },
    reconciliation,
    resolutions: allResolutions,
  };

  return finalise({ base, values, reconciliation, loanRequest, policy, box, clock, tick, gate, resolutions: allResolutions });
}

/** Wraps a pipeline stage: runs it, times it, and appends its audit event. */
function createStageRunner(box, clock, onStage) {
  return async function tick(planId, fn) {
    const plan = STAGE_PLAN.find((p) => p.id === planId);
    // Awaited, so a caller may hold the stage open — the console uses this to
    // pace the progress view. `started` is taken afterwards, so the duration
    // written to the audit trail is real engine time, never presentation delay.
    await onStage({ id: planId, status: 'RUNNING' });
    const started = Date.now();
    const out = await fn();
    const ms = Date.now() - started;
    box.ledger = appendEvent(box.ledger, {
      stage: plan.stage,
      actor: plan.actor,
      summary: out?.summary ?? plan.label,
      detail: out?.detail ?? {},
      durationMs: ms,
      at: clock(),
    });
    onStage({ id: planId, status: 'DONE', ms });
    return out?.value;
  };
}

/* ------------------------------------------------------------------ *
 * Terminal half of the pipeline: money, policy, verdict, memo.
 * ------------------------------------------------------------------ */
async function finalise({ base, values, reconciliation, loanRequest, policy, box, clock, tick, gate, resolutions }) {
  const credit = await tick('CREDIT', () => {
    const c = computeCreditMetrics({ evidence: values, loanRequest, policy });
    return {
      summary: `EMI ${c.metrics.emi}, FOIR ${c.metrics.foir}, LTV ${c.metrics.ltv}`,
      detail: { inputs: c.inputs, metrics: c.metrics, input_hash: c.input_hash, engine_version: c.engine_version },
      value: c,
    };
  });

  const policyEvaluation = await tick('POLICY', () => {
    const p = evaluatePolicy({
      metrics: credit.metrics,
      reconciliation,
      unresolvedLowConfidence: gate.held.length,
      loanRequest,
      policy,
    });
    return {
      summary: `${p.summary.passed}/${p.summary.total} rules passed, ${p.summary.failed} failed, ${p.summary.referred} referred`,
      detail: { policy_version: p.policy_version, policy_hash: p.policy_hash, rules: p.rules.map((r) => `${r.code}:${r.outcome}`) },
      value: p,
    };
  });

  const decision = await tick('DECISION', () => ({
    summary: `${policyEvaluation.decision} — ${policyEvaluation.reason_codes.map((c) => c.code).join(', ')}`,
    detail: { decision: policyEvaluation.decision, reason_codes: policyEvaluation.reason_codes },
    value: { decision: policyEvaluation.decision, reason_codes: policyEvaluation.reason_codes },
  }));

  // The memo quotes the ledger, so it is built from a record that already
  // carries every event up to the decision; the memo's own event is appended
  // after, and the returned record carries the final chain head.
  const record = {
    ...base,
    status: DECISION_TO_STATUS[decision.decision],
    assist: { required: false, queue: [], thresholds: gate.thresholds, resolved: resolutions },
    credit,
    policyEvaluation,
    decision,
    audit: box.ledger,
    generated_at: clock(),
    checkpoint: null,
  };

  const memo = await tick('MEMO', () => {
    const m = buildCreditMemo(record);
    return {
      summary: `Credit memo generated (${m.sections.length} sections)`,
      detail: { sections: m.sections.map((s) => s.id) },
      value: m,
    };
  });

  return { ...record, memo, headline: decisionHeadline(record), audit: box.ledger };
}

/* ------------------------------------------------------------------ *
 * Replay
 * ------------------------------------------------------------------ */

/**
 * Re-execute a completed application from frozen material.
 *
 * Replay never calls the extraction adapter — the evidence is taken verbatim
 * from the stored record, together with the officer's frozen answers. The only
 * thing that may differ is the policy, which is the point of
 * `replayWithPolicy`: same evidence, different rulebook.
 *
 * @returns {{ record, identical, diff }}
 */
export async function replay({ record, policy, label = 'Replay with original policy' }) {
  const fields = record.evidence.fields;
  const values = materialise(fields);
  const loanRequest = {
    amount: record.application.loan_amount,
    tenureMonths: record.application.tenure_months,
    segment: record.application.segment,
  };

  const provisional = computeCreditMetrics({ evidence: values, loanRequest, policy });
  const reconciliation = reconcile({ evidence: values, loanRequest, creditMetrics: provisional, policy });
  const credit = computeCreditMetrics({ evidence: values, loanRequest, policy });
  const policyEvaluation = evaluatePolicy({
    metrics: credit.metrics,
    reconciliation,
    unresolvedLowConfidence: 0,
    loanRequest,
    policy,
  });

  const original = record.credit;
  const identical =
    credit.input_hash === original.input_hash &&
    policyEvaluation.decision === record.decision.decision &&
    JSON.stringify(credit.metrics) === JSON.stringify(original.metrics);

  return {
    label,
    ran_at: new Date().toISOString(),
    used_llm: false,
    policy_version: policy.version,
    policy_hash: policyEvaluation.policy_hash,
    identical,
    credit,
    reconciliation,
    policyEvaluation,
    decision: { decision: policyEvaluation.decision, reason_codes: policyEvaluation.reason_codes },
    diff: diffOutcome(record, { credit, policyEvaluation }),
  };
}

function diffOutcome(record, next) {
  const a = record.credit.metrics;
  const b = next.credit.metrics;
  const rows = [];
  ['emi', 'foir', 'ltv', 'obligations', 'verified_monthly_income'].forEach((k) => {
    if (a[k] !== b[k]) rows.push({ field: k, from: a[k], to: b[k] });
  });
  const beforeCodes = record.decision.reason_codes.map((c) => c.code);
  const afterCodes = next.policyEvaluation.reason_codes.map((c) => c.code);
  return {
    metrics: rows,
    decision: record.decision.decision === next.policyEvaluation.decision
      ? null
      : { from: record.decision.decision, to: next.policyEvaluation.decision },
    reason_codes: {
      added: afterCodes.filter((c) => !beforeCodes.includes(c)),
      removed: beforeCodes.filter((c) => !afterCodes.includes(c)),
    },
  };
}

/* ------------------------------------------------------------------ *
 * What-if
 * ------------------------------------------------------------------ */

/**
 * Build the scenario evaluator the what-if solver drives. Closes over the
 * frozen evidence so every scenario shares one evidence base and differs only
 * in the levers the officer moved.
 */
export function makeScenarioEvaluator({ record, policy }) {
  const values = record.evidence.values;
  return function evaluateScenario(scenario) {
    const loanRequest = {
      amount: scenario.amount,
      tenureMonths: scenario.tenureMonths,
      segment: record.application.segment,
    };
    // A co-applicant contributes verified income; it is injected as an extra
    // monthly credit series so it passes through the same recognition rules.
    const evidence = scenario.coApplicantIncome
      ? withCoApplicant(values, scenario.coApplicantIncome)
      : values;

    const credit = computeCreditMetrics({ evidence, loanRequest, policy });
    const rec = reconcile({ evidence, loanRequest, creditMetrics: credit, policy });
    const evaluation = evaluatePolicy({
      metrics: credit.metrics,
      reconciliation: rec,
      unresolvedLowConfidence: 0,
      loanRequest,
      policy,
    });
    return {
      decision: evaluation.decision,
      metrics: credit.metrics,
      evaluation,
      reason_codes: evaluation.reason_codes,
    };
  };
}

function withCoApplicant(values, monthlyIncome) {
  const credits = values.bank.monthly_credits ?? [];
  return {
    ...values,
    bank: {
      ...values.bank,
      monthly_credits: credits.map((c) => c + monthlyIncome),
      // Co-applicant income is salaried/verified, so it does not inflate the
      // cash component that the haircut penalises.
      monthly_cash_deposits: values.bank.monthly_cash_deposits ?? [],
    },
    platform: values.platform
      ? { ...values.platform, monthly_net: (values.platform.monthly_net ?? []).map((c) => c + monthlyIncome) }
      : values.platform,
  };
}

export function runWhatIf({ record, policy, target }) {
  const evaluate = makeScenarioEvaluator({ record, policy });
  const baseScenario = {
    amount: record.application.loan_amount,
    tenureMonths: record.application.tenure_months,
    coApplicantIncome: 0,
  };
  return solveMinimumChange({ evaluate, baseScenario, policy, segment: record.application.segment, target });
}

export function runSimulation({ record, policy, scenario }) {
  const evaluate = makeScenarioEvaluator({ record, policy });
  const baseScenario = {
    amount: record.application.loan_amount,
    tenureMonths: record.application.tenure_months,
    coApplicantIncome: 0,
  };
  return simulate({ evaluate, baseScenario, scenario });
}

/* ------------------------------------------------------------------ */

function stripPayload(d) {
  const { payload, degrade, ...rest } = d;
  return rest;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/** Injected clock so replay produces stable timestamps when asked to. */
function makeClock(now) {
  if (!now) return () => new Date().toISOString();
  let t = new Date(now).getTime();
  return () => {
    const iso = new Date(t).toISOString();
    t += 1000;
    return iso;
  };
}
