/**
 * RECALLER — narration and credit memo.
 *
 * Produces the prose a credit officer or auditor reads. Every number in the
 * output is interpolated from the deterministic result object; the narrator has
 * no arithmetic of its own and no access to the raw documents.
 *
 * An LLM may be attached to rewrite these sections more fluently (see
 * `narrate({ stylist })`), but it receives the finished figures as text and can
 * only change wording — if the stylist is unavailable or returns anything that
 * alters a figure, the deterministic text stands.
 */

import { formatINR, formatPct, round } from '../../core/src/money.js';
import { DECISIONS, FINDING_STATUS } from '../../core/src/constants.js';

const VERDICT_LEAD = {
  APPROVE: 'The application meets policy on every binding rule and is recommended for sanction.',
  REFER: 'The application cannot be auto-sanctioned and is referred for officer judgement.',
  REJECT: 'The application breaches a binding credit rule and is declined.',
};

/**
 * Build the structured credit memo.
 * @param {object} record the full application record (see packages/orchestrator)
 */
export function buildCreditMemo(record) {
  const { application, evidence, reconciliation, credit, policyEvaluation, decision, audit } = record;
  const m = credit.metrics;
  const v = evidence.values;

  const sections = [];

  sections.push({
    id: 'summary',
    title: 'Recommendation',
    kind: 'verdict',
    body: [
      VERDICT_LEAD[decision.decision],
      decision.decision === DECISIONS.APPROVE
        ? `Sanction ${formatINR(m.loan_amount)} over ${m.tenure_months} months at ${credit.inputs.rate_annual_pct}% p.a., repayable at ${formatINR(m.emi, { decimals: 2 })} per month.`
        : decision.decision === DECISIONS.REFER
          ? 'The items below must be settled by an officer before the file can move.'
          : 'The breaches below are not waivable at branch level.',
    ].join(' '),
  });

  sections.push({
    id: 'borrower',
    title: 'Borrower and facility',
    kind: 'table',
    rows: [
      ['Applicant', v.applicant?.name ?? '—'],
      ['Age', v.applicant?.age != null ? `${v.applicant.age} years` : '—'],
      ['KYC reference', v.applicant?.id_number ?? '—'],
      ['PAN', v.applicant?.pan ?? '—'],
      ['Asset', `${v.invoice?.model ?? '—'} (${application.segment_label})`],
      ['Dealer', v.invoice?.dealer_name ?? '—'],
      ['On-road price', formatINR(m.loan_amount && credit.inputs.invoice_on_road_price)],
      ['Requested facility', formatINR(m.loan_amount)],
      ['Tenure', `${m.tenure_months} months`],
      ['Rate', `${credit.inputs.rate_annual_pct}% p.a. reducing`],
    ],
  });

  sections.push({
    id: 'income',
    title: 'Income assessment',
    kind: 'prose',
    body: incomeNarrative(credit),
  });

  sections.push({
    id: 'metrics',
    title: 'Credit metrics',
    kind: 'metrics',
    note: 'Computed by the RECALLER calculation engine from gated evidence. No language model contributed to these figures.',
    rows: [
      ['Verified monthly income', formatINR(m.verified_monthly_income, { decimals: 2 })],
      ['Existing obligations', formatINR(m.obligations, { decimals: 2 })],
      ['Proposed EMI', formatINR(m.emi, { decimals: 2 })],
      ['FOIR', formatPct(m.foir)],
      ['LTV', formatPct(m.ltv)],
      ['Residual income after EMI', formatINR(m.disposable_income, { decimals: 2 })],
      ['Total interest over term', formatINR(m.total_interest, { decimals: 2 })],
    ],
  });

  sections.push({
    id: 'reconciliation',
    title: 'Cross-document reconciliation',
    kind: 'findings',
    body: reconciliationNarrative(reconciliation),
    items: reconciliation.findings.map((f) => ({
      code: f.code,
      label: f.label,
      status: f.status,
      detail: findingDetail(f),
    })),
  });

  sections.push({
    id: 'policy',
    title: 'Policy evaluation',
    kind: 'policy',
    body: `Evaluated against policy ${policyEvaluation.policy_id} v${policyEvaluation.policy_version} (effective ${policyEvaluation.policy_effective_date}, hash ${policyEvaluation.policy_hash}). ${policyEvaluation.summary.passed} of ${policyEvaluation.summary.total} rules passed, ${policyEvaluation.summary.referred} referred, ${policyEvaluation.summary.failed} failed.`,
    items: policyEvaluation.rules
      .filter((r) => r.outcome !== 'NOT_APPLICABLE')
      .map((r) => ({ code: r.code, label: r.label, outcome: r.outcome, detail: r.detail })),
  });

  sections.push({
    id: 'reasons',
    title: 'Reason codes',
    kind: 'codes',
    items: decision.reason_codes,
  });

  const interventions = Object.values(evidence.fields).filter((f) => f.provenance === 'OFFICER');
  sections.push({
    id: 'interventions',
    title: 'Officer interventions',
    kind: 'interventions',
    body: interventions.length
      ? `${interventions.length} field${interventions.length === 1 ? ' was' : 's were'} confirmed or amended by a human before decisioning.`
      : 'No officer intervention was required; every field cleared the confidence gate automatically.',
    items: interventions.map((f) => ({
      path: f.path,
      label: f.label,
      action: f.officer?.action,
      from: f.superseded?.value ?? null,
      to: f.value,
      original_confidence: f.superseded?.confidence ?? null,
      by: f.officer?.by,
      at: f.officer?.at,
      note: f.officer?.note ?? null,
    })),
  });

  sections.push({
    id: 'evidence',
    title: 'Evidence citations',
    kind: 'citations',
    items: Object.values(evidence.fields)
      .filter((f) => f.citation)
      .map((f) => ({
        label: f.label,
        value: displayValue(f),
        confidence: f.confidence,
        provenance: f.provenance,
        document: f.citation.document,
        page: f.citation.page,
      })),
  });

  sections.push({
    id: 'provenance',
    title: 'Provenance',
    kind: 'table',
    rows: [
      ['Application ID', application.id],
      ['Trace ID', audit.traceId],
      ['Ledger head', audit.head],
      ['Engine version', credit.engine_version],
      ['Policy version', `${policyEvaluation.policy_id} v${policyEvaluation.policy_version}`],
      ['Policy hash', policyEvaluation.policy_hash],
      ['Calculation input hash', credit.input_hash],
      ['Extraction hash', evidence.extraction_hash],
      ['Extraction adapter', evidence.stats.adapter],
      ['Workflow execution', record.execution?.n8n_execution_id ?? 'local'],
      ['Workflow version', record.execution?.workflow_version ?? '—'],
      ['Generated at', new Date(record.generated_at ?? Date.now()).toISOString()],
    ],
  });

  return {
    application_id: application.id,
    decision: decision.decision,
    generated_at: record.generated_at ?? new Date().toISOString(),
    title: `Credit memorandum — ${v.applicant?.name ?? application.borrower_name} — ${application.id}`,
    sections,
  };
}

function displayValue(f) {
  if (f.value === null || f.value === undefined) return '—';
  if (Array.isArray(f.value)) return `${f.value.length} values`;
  if (f.type === 'money') return formatINR(f.value, { decimals: 2 });
  if (typeof f.value === 'object') return `${Object.keys(f.value).length} entries`;
  return String(f.value);
}

function incomeNarrative(credit) {
  const b = credit.income_breakdown;
  const parts = [];
  parts.push(
    `Income is recognised on the ${methodLabel(b.method)} basis over a ${b.window_months}-month window; ${b.months_observed} month${b.months_observed === 1 ? '' : 's'} of statement history was available.`,
  );
  parts.push(
    `Mean monthly qualifying credits were ${formatINR(b.components.mean_monthly_credits, { decimals: 2 })}, of which ${formatINR(b.components.mean_monthly_cash, { decimals: 2 })} arrived as cash deposits. Cash was discounted ${formatPct(b.components.cash_haircut, 0)} and then capped as a share of recognised income, admitting ${formatINR(b.components.cash_admitted, { decimals: 2 })}.`,
  );
  if (b.platform_view !== null) {
    parts.push(
      `Platform settlements averaged ${formatINR(b.components.mean_platform_settlement, { decimals: 2 })} per month; after a ${formatPct(b.components.platform_haircut, 0)} haircut for churn the platform view is ${formatINR(b.platform_view, { decimals: 2 })}. The bank view is ${formatINR(b.bank_view, { decimals: 2 })}, and the lower of the two is taken.`,
    );
  } else {
    parts.push('No platform earnings statement was supplied, so the bank view stands alone.');
  }
  parts.push(
    `Recognised income is ${formatINR(b.verified_monthly_income, { decimals: 2 })} per month, with month-on-month dispersion of ${formatPct(b.volatility)}.`,
  );
  return parts.join(' ');
}

function methodLabel(method) {
  return method === 'LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET'
    ? 'lower-of-bank-run-rate-and-platform-net'
    : String(method).toLowerCase().replace(/_/g, ' ');
}

function reconciliationNarrative(rec) {
  if (rec.blocking === 0 && rec.advisory === 0) {
    return `All ${rec.total} cross-document checks agree within policy tolerance.`;
  }
  const bits = [];
  if (rec.blocking) bits.push(`${rec.blocking} blocking contradiction${rec.blocking === 1 ? '' : 's'}`);
  if (rec.advisory) bits.push(`${rec.advisory} advisory discrepanc${rec.advisory === 1 ? 'y' : 'ies'}`);
  return `Of ${rec.total} cross-document checks, ${bits.join(' and ')} were raised. Blocking items must be cleared before sanction; advisory items require officer judgement.`;
}

function findingDetail(f) {
  const { left, right } = f.comparison;
  if (f.status === FINDING_STATUS.MATCHED) {
    return `${left.field} and ${right.field} agree${f.similarity !== undefined ? ` (similarity ${formatPct(f.similarity)})` : ''}.`;
  }
  if (f.similarity !== undefined) {
    return `"${left.value}" (${left.source}) against "${right.value}" (${right.source}) — similarity ${formatPct(f.similarity)}, floor ${formatPct(f.tolerance.advisory_score)}.`;
  }
  return `${formatINR(left.value)} (${left.source}) against ${formatINR(right.value)} (${right.source}) — a gap of ${formatINR(f.delta)}, ${formatPct(f.delta_pct)} of the larger figure.`;
}

/**
 * One-line decision rationale for the dashboard and the decision screen.
 * Deterministic; used when a stylist LLM is not configured.
 */
export function decisionHeadline(record) {
  const { decision, credit } = record;
  const m = credit.metrics;
  if (decision.decision === DECISIONS.APPROVE) {
    return `Affordability holds at ${formatPct(m.foir)} FOIR against a ${formatPct(0.5)} ceiling, with ${formatINR(m.disposable_income)} residual income after the instalment.`;
  }
  const drivers = decision.reason_codes.filter((c) => c.code.startsWith('R')).map((c) => c.text);
  if (drivers.length) return drivers.join('; ') + '.';
  const refers = decision.reason_codes.filter((c) => c.code.startsWith('F')).map((c) => c.text);
  return refers.length ? refers.join('; ') + '.' : 'Referred for officer judgement.';
}

/**
 * Optional LLM pass. The stylist receives finished text and returns finished
 * text. Any figure it alters is a defect, so the caller compares the numeric
 * tokens and discards the rewrite if they moved.
 */
export async function narrate(memo, { stylist } = {}) {
  if (!stylist) return memo;
  const sections = await Promise.all(
    memo.sections.map(async (s) => {
      if (s.kind !== 'prose' || !s.body) return s;
      try {
        const rewritten = await stylist(s.body);
        return numericTokens(rewritten) === numericTokens(s.body) ? { ...s, body: rewritten, styled: true } : s;
      } catch {
        return s; // the deterministic text always stands
      }
    }),
  );
  return { ...memo, sections };
}

function numericTokens(text) {
  return (String(text).match(/[\d.,]+/g) ?? []).join('|');
}

export { round };
