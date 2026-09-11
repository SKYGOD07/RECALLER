/**
 * RECALLER — cross-document reconciliation.
 *
 * JavaScript port of recaller/reconciliation/reconcile.py.
 * Extraction tells us what each document says. Reconciliation asks whether the
 * documents agree with each other, and grades every disagreement against
 * policy-configured tolerances.
 */

import { FINDING_STATUS } from '@core/constants.js'
import { roundHalfUp } from '@core/money.js'

/**
 * Normalise name or address strings for robust comparison.
 */
export function normalise(s) {
  if (s == null) return ''
  let st = String(s).toUpperCase()
  st = st.replace(/\b(MR|MRS|MS|SHRI|SMT|DR|SON OF|S\/O|D\/O|W\/O)\b/g, ' ')
  st = st.replace(/[^A-Z0-9 ]/g, ' ')
  st = st.replace(/\s+/g, ' ')
  return st.trim()
}

/**
 * Levenshtein distance, iterative two-row form.
 */
export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a) return b.length
  if (!b) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1, ...new Array(b.length).fill(0)]
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost)
    }
    prev = cur
  }
  return prev[b.length]
}

/**
 * Name similarity tolerating reordered tokens, initials, and spelling variants.
 */
export function nameSimilarity(a, b) {
  const A = normalise(a)
  const B = normalise(b)
  if (!A || !B) return 0
  if (A === B) return 1
  const ta = A.split(' ').filter(Boolean)
  const tb = B.split(' ').filter(Boolean)
  const [shortTokens, longTokens] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const usedIndices = new Set()
  let score = 0

  for (const token of shortTokens) {
    let best = 0
    let bestIdx = -1
    for (let idx = 0; idx < longTokens.length; idx++) {
      if (usedIndices.has(idx)) continue
      const other = longTokens[idx]
      let s
      if (token === other) {
        s = 1
      } else if (token.length === 1 || other.length === 1) {
        s = token[0] === other[0] ? 0.8 : 0
      } else {
        const d = levenshtein(token, other)
        s = 1 - d / Math.max(token.length, other.length)
      }
      if (s > best) {
        best = s
        bestIdx = idx
      }
    }
    if (bestIdx >= 0 && best > 0.5) usedIndices.add(bestIdx)
    score += best
  }

  const coverage = shortTokens.length ? score / shortTokens.length : 0
  const lengthPenalty = 1 - (longTokens.length - shortTokens.length) * 0.06
  return roundHalfUp(Math.max(0, Math.min(1, coverage * lengthPenalty)), 4)
}

/**
 * Address agreement scored by containment rather than symmetric overlap.
 */
export function addressSimilarity(a, b) {
  const A = new Set(normalise(a).split(' ').filter((t) => t.length > 2))
  const B = new Set(normalise(b).split(' ').filter((t) => t.length > 2))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const t of A) if (B.has(t)) hit++
  return roundHalfUp(hit / Math.min(A.size, B.size), 4)
}

function pctFinding({ code, label, left, right, tolerance, evidence, note }) {
  const base = Math.max(Math.abs(Number(left.value)), Math.abs(Number(right.value)), 1)
  const delta = roundHalfUp(Math.abs(Number(left.value) - Number(right.value)), 2)
  const deltaPct = roundHalfUp(delta / base, 4)

  let status = FINDING_STATUS.MATCHED
  if (deltaPct >= (tolerance.blocking_pct ?? 1)) {
    status = FINDING_STATUS.BLOCKING
  } else if (deltaPct >= (tolerance.advisory_pct ?? 0)) {
    status = FINDING_STATUS.ADVISORY
  }

  const severity =
    status === FINDING_STATUS.BLOCKING ? 'BLOCKING' : status === FINDING_STATUS.ADVISORY ? 'ADVISORY' : 'INFO'

  return {
    code, label, status, severity,
    comparison: { left, right },
    delta, delta_pct: deltaPct, tolerance, evidence, note,
    resolution: null,
  }
}

function scoreFinding({ code, label, left, right, tolerance, evidence, similarity, note }) {
  let status = FINDING_STATUS.MATCHED
  if (similarity < (tolerance.blocking_score ?? 0)) {
    status = FINDING_STATUS.BLOCKING
  } else if (similarity < (tolerance.advisory_score ?? 0)) {
    status = FINDING_STATUS.MISMATCH
  }

  const severity =
    status === FINDING_STATUS.BLOCKING ? 'BLOCKING' : status === FINDING_STATUS.MISMATCH ? 'ADVISORY' : 'INFO'

  return {
    code, label, status, severity,
    comparison: { left, right },
    similarity, tolerance, evidence, note,
    resolution: null,
  }
}

function meanOf(xs) {
  if (!xs || xs.length === 0) return 0
  return roundHalfUp(xs.reduce((a, x) => a + Number(x), 0) / xs.length, 2)
}

/**
 * Reconcile a validated evidence bundle across documents.
 */
export function reconcile({ evidence, loanRequest, creditMetrics, policy }) {
  const tol = policy.reconciliation || {}
  const findings = []
  const applicant = evidence.applicant || {}
  const bank = evidence.bank || {}
  const platform = evidence.platform || {}
  const invoice = evidence.invoice || {}

  // 1 — Declared income vs verified bank income
  if (applicant.declared_monthly_income != null) {
    findings.push(pctFinding({
      code: 'RC-INC-01', label: 'Declared income vs verified bank income',
      left: { field: 'Declared monthly income', value: roundHalfUp(applicant.declared_monthly_income, 2), source: 'Application form', kind: 'money' },
      right: { field: 'Verified monthly income', value: (creditMetrics.metrics || {}).verified_monthly_income, source: 'BankStatement.pdf', kind: 'money' },
      tolerance: tol.income_declared_vs_verified || {}, evidence: ['applicant.declared_monthly_income', 'income.verified_monthly_income'],
      note: 'Verified income is derived from qualifying credits after policy haircuts.',
    }))
  }

  // 2 — Platform earnings vs bank credits
  if (platform.monthly_net) {
    const platMean = meanOf(platform.monthly_net)
    const bankMean = meanOf(bank.monthly_credits)
    findings.push(pctFinding({
      code: 'RC-INC-02', label: 'Platform settlements vs bank credits',
      left: { field: 'Mean monthly platform settlement', value: platMean, source: `${platform.provider || 'Platform'}Earnings.pdf`, kind: 'money' },
      right: { field: 'Mean monthly bank credits', value: bankMean, source: 'BankStatement.pdf', kind: 'money' },
      tolerance: tol.platform_vs_bank_credits || {}, evidence: ['platform.monthly_net', 'bank.monthly_credits'],
      note: 'Settlements should land in the linked account; a large gap suggests an undisclosed account.',
    }))
  }

  // 3 — Invoice amount vs on-road price
  const computedOnRoad = roundHalfUp(
    Number(invoice.ex_showroom || 0) + Number(invoice.insurance || 0) +
    Number(invoice.registration || 0) + Number(invoice.accessories || 0), 2)
  findings.push(pctFinding({
    code: 'RC-AST-01', label: 'Invoice ex-showroom + charges vs stated on-road price',
    left: { field: 'Computed on-road total', value: computedOnRoad, source: 'DealerInvoice.pdf', kind: 'money' },
    right: { field: 'Stated on-road price', value: roundHalfUp(invoice.on_road_price || 0, 2), source: 'DealerInvoice.pdf', kind: 'money' },
    tolerance: tol.invoice_vs_onroad || {}, evidence: ['invoice.ex_showroom', 'invoice.on_road_price'],
    note: 'Inflated on-road price is the common route to an over-funded asset.',
  }))

  // 4 — Applicant name vs bank account holder
  const nameSim = nameSimilarity(applicant.name, bank.account_holder_name)
  findings.push(scoreFinding({
    code: 'RC-KYC-01', label: 'Applicant name vs bank account holder name',
    left: { field: 'Applicant name', value: applicant.name, source: 'Aadhaar.pdf', kind: 'text' },
    right: { field: 'Bank account holder', value: bank.account_holder_name, source: 'BankStatement.pdf', kind: 'text' },
    similarity: nameSim, tolerance: tol.name_match || {}, evidence: ['applicant.name', 'bank.account_holder_name'],
    note: 'Repayment must be collected from an account the borrower owns.',
  }))

  // 5 — KYC name vs PAN name
  if (applicant.pan_name) {
    const panSim = nameSimilarity(applicant.name, applicant.pan_name)
    findings.push(scoreFinding({
      code: 'RC-KYC-02', label: 'Aadhaar name vs PAN name',
      left: { field: 'Aadhaar name', value: applicant.name, source: 'Aadhaar.pdf', kind: 'text' },
      right: { field: 'PAN name', value: applicant.pan_name, source: 'PAN.pdf', kind: 'text' },
      similarity: panSim, tolerance: tol.name_match || {}, evidence: ['applicant.name', 'applicant.pan_name'],
    }))
  }

  // 6 — KYC address vs bank statement address
  if (bank.address) {
    const addrSim = addressSimilarity(applicant.address, bank.address)
    findings.push(scoreFinding({
      code: 'RC-ADR-01', label: 'KYC address vs bank statement address',
      left: { field: 'KYC address', value: applicant.address, source: 'Aadhaar.pdf', kind: 'text' },
      right: { field: 'Statement address', value: bank.address, source: 'BankStatement.pdf', kind: 'text' },
      similarity: addrSim, tolerance: tol.address_match || {}, evidence: ['applicant.address', 'bank.address'],
      note: 'Address drift is expected for migrant borrowers; treated as advisory, not disqualifying.',
    }))
  }

  // 7 — Requested amount vs invoice-supported amount
  findings.push(pctFinding({
    code: 'RC-LON-01', label: 'Requested loan vs invoice-supported funding',
    left: { field: 'Requested loan amount', value: roundHalfUp(loanRequest.amount || 0, 2), source: 'Application form', kind: 'money' },
    right: { field: 'Invoice on-road price', value: roundHalfUp(invoice.on_road_price || 0, 2), source: 'DealerInvoice.pdf', kind: 'money' },
    tolerance: { advisory_pct: 1, blocking_pct: 1.01 }, evidence: ['loan.amount', 'invoice.on_road_price'],
    note: 'Funding headroom is governed by the LTV rule; shown here for context.',
  }))

  // 8 — Vehicle segment vs invoice description
  if (invoice.vehicle_category) {
    const agrees = invoice.vehicle_category === loanRequest.segment
    findings.push({
      code: 'RC-AST-02', label: 'Applied asset segment vs invoiced vehicle category',
      status: agrees ? FINDING_STATUS.MATCHED : FINDING_STATUS.BLOCKING,
      severity: agrees ? 'INFO' : 'BLOCKING',
      comparison: {
        left: { field: 'Applied segment', value: loanRequest.segment, source: 'Application form', kind: 'text' },
        right: { field: 'Invoiced category', value: invoice.vehicle_category, source: 'DealerInvoice.pdf', kind: 'text' },
      },
      tolerance: null, evidence: ['loan.segment', 'invoice.vehicle_category'],
      note: 'Product pricing and caps are segment-specific.',
      resolution: null,
    })
  }

  return summarise(findings)
}

/**
 * Recount severities across findings, considering officer waivers.
 */
export function summarise(findings) {
  const live = findings.filter((f) => (f.resolution || {}).action !== 'WAIVED')
  const blocking = live.filter((f) => f.status === FINDING_STATUS.BLOCKING).length
  const advisory = live.filter(
    (f) => f.status === FINDING_STATUS.ADVISORY || f.status === FINDING_STATUS.MISMATCH
  ).length
  const matched = findings.filter((f) => f.status === FINDING_STATUS.MATCHED).length
  return { findings, blocking, advisory, matched, total: findings.length }
}
