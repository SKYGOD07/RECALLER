/**
 * RECALLER — cross-document reconciliation.
 *
 * Extraction tells us what each document says. Reconciliation asks whether the
 * documents agree with each other, and grades every disagreement against
 * policy-configured tolerances. Findings are evidence for the policy engine;
 * they never decide anything themselves.
 */

import { round } from '../../core/src/money.js';
import { FINDING_STATUS } from '../../core/src/constants.js';

/* ------------------------------------------------------------------ *
 * String similarity — used for name and address agreement.
 * ------------------------------------------------------------------ */

function normalise(s) {
  return String(s ?? '')
    .toUpperCase()
    .replace(/\b(MR|MRS|MS|SHRI|SMT|DR|SON OF|S\/O|D\/O|W\/O)\b/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, iterative two-row form. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Name similarity that tolerates the real-world shapes of Indian names:
 * reordered tokens, dropped middle names, initials standing in for a word.
 * Returns 0..1.
 */
export function nameSimilarity(a, b) {
  const A = normalise(a);
  const B = normalise(b);
  if (!A || !B) return 0;
  if (A === B) return 1;

  const ta = A.split(' ').filter(Boolean);
  const tb = B.split(' ').filter(Boolean);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];

  const used = new Set();
  let score = 0;
  for (const token of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((other, idx) => {
      if (used.has(idx)) return;
      let s;
      if (token === other) s = 1;
      else if (token.length === 1 || other.length === 1) {
        // An initial matches the word it abbreviates, at a discount.
        s = token[0] === other[0] ? 0.8 : 0;
      } else {
        const d = levenshtein(token, other);
        s = 1 - d / Math.max(token.length, other.length);
      }
      if (s > best) {
        best = s;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0 && best > 0.5) used.add(bestIdx);
    score += best;
  }
  // Extra tokens on the longer name dilute the score, but only gently.
  const coverage = score / short.length;
  const lengthPenalty = 1 - (long.length - short.length) * 0.06;
  return round(Math.max(0, Math.min(1, coverage * lengthPenalty)), 4);
}

/**
 * Address agreement, scored by containment rather than symmetric overlap.
 *
 * A bank statement routinely prints a shortened address — locality, city, PIN —
 * where the Aadhaar carries house number, lane and landmark. Symmetric overlap
 * reads that abbreviation as a contradiction, which it is not. Containment
 * (|A∩B| / min(|A|,|B|)) treats one address being a subset of the other as
 * agreement, while a genuinely different locality still scores near zero.
 */
export function addressSimilarity(a, b) {
  const A = new Set(normalise(a).split(' ').filter((t) => t.length > 2));
  const B = new Set(normalise(b).split(' ').filter((t) => t.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((t) => {
    if (B.has(t)) hit += 1;
  });
  return round(hit / Math.min(A.size, B.size), 4);
}

/* ------------------------------------------------------------------ *
 * Finding construction
 * ------------------------------------------------------------------ */

function pctFinding({ code, label, left, right, tolerance, evidence, note }) {
  const base = Math.max(Math.abs(left.value), Math.abs(right.value), 1);
  const delta = round(Math.abs(left.value - right.value), 2);
  const deltaPct = round(delta / base, 4);

  let status = FINDING_STATUS.MATCHED;
  if (deltaPct >= tolerance.blocking_pct) status = FINDING_STATUS.BLOCKING;
  else if (deltaPct >= tolerance.advisory_pct) status = FINDING_STATUS.ADVISORY;

  return {
    code,
    label,
    status,
    severity: status === FINDING_STATUS.BLOCKING ? 'BLOCKING' : status === FINDING_STATUS.ADVISORY ? 'ADVISORY' : 'INFO',
    comparison: { left, right },
    delta,
    delta_pct: deltaPct,
    tolerance,
    evidence,
    note: note ?? null,
    resolution: null,
  };
}

function scoreFinding({ code, label, left, right, tolerance, evidence, similarity, note }) {
  let status = FINDING_STATUS.MATCHED;
  if (similarity < tolerance.blocking_score) status = FINDING_STATUS.BLOCKING;
  else if (similarity < tolerance.advisory_score) status = FINDING_STATUS.MISMATCH;

  return {
    code,
    label,
    status,
    severity: status === FINDING_STATUS.BLOCKING ? 'BLOCKING' : status === FINDING_STATUS.MISMATCH ? 'ADVISORY' : 'INFO',
    comparison: { left, right },
    similarity,
    tolerance,
    evidence,
    note: note ?? null,
    resolution: null,
  };
}

/**
 * Reconcile a validated evidence bundle.
 *
 * @param {object} args
 * @param {object} args.evidence  validated evidence values
 * @param {object} args.loanRequest
 * @param {object} args.creditMetrics deterministic metrics (for verified income)
 * @param {object} args.policy
 */
export function reconcile({ evidence, loanRequest, creditMetrics, policy }) {
  const tol = policy.reconciliation;
  const findings = [];

  /* 1 — Declared income vs verified bank income --------------------- */
  if (evidence.applicant.declared_monthly_income != null) {
    findings.push(
      pctFinding({
        code: 'RC-INC-01',
        label: 'Declared income vs verified bank income',
        left: {
          field: 'Declared monthly income',
          value: round(evidence.applicant.declared_monthly_income, 2),
          source: 'Application form',
          kind: 'money',
        },
        right: {
          field: 'Verified monthly income',
          value: creditMetrics.metrics.verified_monthly_income,
          source: 'BankStatement.pdf',
          kind: 'money',
        },
        tolerance: tol.income_declared_vs_verified,
        evidence: ['applicant.declared_monthly_income', 'income.verified_monthly_income'],
        note: 'Verified income is derived from qualifying credits after policy haircuts.',
      }),
    );
  }

  /* 2 — Platform earnings vs bank credits --------------------------- */
  if (evidence.platform?.monthly_net?.length) {
    const platMean = meanOf(evidence.platform.monthly_net);
    const bankMean = meanOf(evidence.bank.monthly_credits);
    findings.push(
      pctFinding({
        code: 'RC-INC-02',
        label: 'Platform settlements vs bank credits',
        left: {
          field: 'Mean monthly platform settlement',
          value: platMean,
          source: `${evidence.platform.provider ?? 'Platform'}Earnings.pdf`,
          kind: 'money',
        },
        right: {
          field: 'Mean monthly bank credits',
          value: bankMean,
          source: 'BankStatement.pdf',
          kind: 'money',
        },
        tolerance: tol.platform_vs_bank_credits,
        evidence: ['platform.monthly_net', 'bank.monthly_credits'],
        note: 'Settlements should land in the linked account; a large gap suggests an undisclosed account.',
      }),
    );
  }

  /* 3 — Invoice amount vs on-road price ----------------------------- */
  findings.push(
    pctFinding({
      code: 'RC-AST-01',
      label: 'Invoice ex-showroom + charges vs stated on-road price',
      left: {
        field: 'Computed on-road total',
        value: round(
          (evidence.invoice.ex_showroom ?? 0) +
            (evidence.invoice.insurance ?? 0) +
            (evidence.invoice.registration ?? 0) +
            (evidence.invoice.accessories ?? 0),
          2,
        ),
        source: 'DealerInvoice.pdf',
        kind: 'money',
      },
      right: {
        field: 'Stated on-road price',
        value: round(evidence.invoice.on_road_price, 2),
        source: 'DealerInvoice.pdf',
        kind: 'money',
      },
      tolerance: tol.invoice_vs_onroad,
      evidence: ['invoice.ex_showroom', 'invoice.on_road_price'],
      note: 'Inflated on-road price is the common route to an over-funded asset.',
    }),
  );

  /* 4 — Applicant name vs bank account holder ----------------------- */
  const nameSim = nameSimilarity(evidence.applicant.name, evidence.bank.account_holder_name);
  findings.push(
    scoreFinding({
      code: 'RC-KYC-01',
      label: 'Applicant name vs bank account holder name',
      left: { field: 'Applicant name', value: evidence.applicant.name, source: 'Aadhaar.pdf', kind: 'text' },
      right: {
        field: 'Bank account holder',
        value: evidence.bank.account_holder_name,
        source: 'BankStatement.pdf',
        kind: 'text',
      },
      similarity: nameSim,
      tolerance: tol.name_match,
      evidence: ['applicant.name', 'bank.account_holder_name'],
      note: 'Repayment must be collected from an account the borrower owns.',
    }),
  );

  /* 5 — KYC name vs PAN name ---------------------------------------- */
  if (evidence.applicant.pan_name) {
    const panSim = nameSimilarity(evidence.applicant.name, evidence.applicant.pan_name);
    findings.push(
      scoreFinding({
        code: 'RC-KYC-02',
        label: 'Aadhaar name vs PAN name',
        left: { field: 'Aadhaar name', value: evidence.applicant.name, source: 'Aadhaar.pdf', kind: 'text' },
        right: { field: 'PAN name', value: evidence.applicant.pan_name, source: 'PAN.pdf', kind: 'text' },
        similarity: panSim,
        tolerance: tol.name_match,
        evidence: ['applicant.name', 'applicant.pan_name'],
      }),
    );
  }

  /* 6 — KYC address vs bank statement address ----------------------- */
  if (evidence.bank.address) {
    const addrSim = addressSimilarity(evidence.applicant.address, evidence.bank.address);
    findings.push(
      scoreFinding({
        code: 'RC-ADR-01',
        label: 'KYC address vs bank statement address',
        left: { field: 'KYC address', value: evidence.applicant.address, source: 'Aadhaar.pdf', kind: 'text' },
        right: { field: 'Statement address', value: evidence.bank.address, source: 'BankStatement.pdf', kind: 'text' },
        similarity: addrSim,
        tolerance: tol.address_match,
        evidence: ['applicant.address', 'bank.address'],
        note: 'Address drift is expected for migrant borrowers; treated as advisory, not disqualifying.',
      }),
    );
  }

  /* 7 — Requested amount vs invoice-supported amount ---------------- */
  findings.push(
    pctFinding({
      code: 'RC-LON-01',
      label: 'Requested loan vs invoice-supported funding',
      left: { field: 'Requested loan amount', value: round(loanRequest.amount, 2), source: 'Application form', kind: 'money' },
      right: {
        field: 'Invoice on-road price',
        value: round(evidence.invoice.on_road_price, 2),
        source: 'DealerInvoice.pdf',
        kind: 'money',
      },
      tolerance: { advisory_pct: 1, blocking_pct: 1.01 }, // informational: LTV rule governs
      evidence: ['loan.amount', 'invoice.on_road_price'],
      note: 'Funding headroom is governed by the LTV rule; shown here for context.',
    }),
  );

  /* 8 — Vehicle segment vs invoice description ---------------------- */
  if (evidence.invoice.vehicle_category) {
    const agrees = evidence.invoice.vehicle_category === loanRequest.segment;
    findings.push({
      code: 'RC-AST-02',
      label: 'Applied asset segment vs invoiced vehicle category',
      status: agrees ? FINDING_STATUS.MATCHED : FINDING_STATUS.BLOCKING,
      severity: agrees ? 'INFO' : 'BLOCKING',
      comparison: {
        left: { field: 'Applied segment', value: loanRequest.segment, source: 'Application form', kind: 'text' },
        right: {
          field: 'Invoiced category',
          value: evidence.invoice.vehicle_category,
          source: 'DealerInvoice.pdf',
          kind: 'text',
        },
      },
      tolerance: null,
      evidence: ['loan.segment', 'invoice.vehicle_category'],
      note: 'Product pricing and caps are segment-specific.',
      resolution: null,
    });
  }

  return summarise(findings);
}

function meanOf(xs) {
  if (!xs?.length) return 0;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length, 2);
}

/** Recount severities — also used after an officer resolves a finding. */
export function summarise(findings) {
  const live = findings.filter((f) => f.resolution?.action !== 'WAIVED');
  return {
    findings,
    blocking: live.filter((f) => f.status === FINDING_STATUS.BLOCKING).length,
    advisory: live.filter((f) => f.status === FINDING_STATUS.ADVISORY || f.status === FINDING_STATUS.MISMATCH).length,
    matched: findings.filter((f) => f.status === FINDING_STATUS.MATCHED).length,
    total: findings.length,
  };
}
