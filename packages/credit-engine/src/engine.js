/**
 * RECALLER — deterministic credit calculation engine.
 *
 * JavaScript port of recaller/credit_engine/engine.py.
 * This module is the ONLY place in the system permitted to produce EMI, FOIR,
 * LTV, obligation totals, recognised income or the evidence-strength score.
 * Every function is pure: same inputs, same outputs, forever.
 */

import { ENGINE_VERSION } from '@core/constants.js'
import { hashValue } from '@core/hash.js'
import { roundHalfUp, toPaise, toRupees, sumRupees } from '@core/money.js'

/**
 * Equated Monthly Instalment on a reducing-balance loan.
 * EMI = P · r · (1+r)^n / ((1+r)^n − 1), r = annual rate / 12 / 100
 */
export function calculateEmi(principal, annualRatePct, tenureMonths) {
  const p = toRupees(toPaise(principal))
  let n
  try {
    n = Math.round(Number(tenureMonths))
  } catch {
    n = 0
  }
  if (!(p > 0) || !(n > 0)) return 0
  const r = Number(annualRatePct) / 12 / 100
  if (r === 0) return roundHalfUp(p / n, 2)
  const growth = (1 + r) ** n
  return roundHalfUp((p * r * growth) / (growth - 1), 2)
}

/**
 * Full amortisation schedule. Interest is computed on opening balance.
 */
export function amortisationSchedule(principal, annualRatePct, tenureMonths) {
  const emi = calculateEmi(principal, annualRatePct, tenureMonths)
  const n = Math.round(Number(tenureMonths))
  const r = Number(annualRatePct) / 12 / 100
  let balancePaise = toPaise(principal)
  const rows = []

  for (let m = 1; m <= n; m++) {
    const opening = balancePaise
    const interest = Math.round(roundHalfUp(opening * r, 0))
    let payment = toPaise(emi)
    let principalPart = payment - interest
    if (m === n || principalPart >= opening) {
      principalPart = opening
      payment = principalPart + interest
    }
    balancePaise = opening - principalPart
    rows.push({
      month: m,
      opening: toRupees(opening),
      payment: toRupees(payment),
      interest: toRupees(interest),
      principal: toRupees(principalPart),
      closing: toRupees(balancePaise),
    })
    if (balancePaise <= 0) break
  }

  const totalInterest = toRupees(rows.reduce((acc, x) => acc + toPaise(x.interest), 0))
  const totalPayable = roundHalfUp(toRupees(toPaise(principal)) + totalInterest, 2)
  return { emi, rows, totalInterest, totalPayable }
}

/**
 * Fixed Obligation to Income Ratio (FOIR).
 */
export function calculateFoir(verifiedMonthlyIncome, existingObligations, proposedEmi, ratioDp = 4) {
  const income = toRupees(toPaise(verifiedMonthlyIncome))
  if (!(income > 0)) return null
  const outflow = toRupees(toPaise(existingObligations) + toPaise(proposedEmi))
  return roundHalfUp(outflow / income, ratioDp)
}

/**
 * Loan to Value (LTV).
 */
export function calculateLtv(loanAmount, assetValue, ratioDp = 4) {
  const value = toRupees(toPaise(assetValue))
  if (!(value > 0)) return null
  return roundHalfUp(toRupees(toPaise(loanAmount)) / value, ratioDp)
}

/**
 * Total existing monthly obligations from classified recurring debits.
 */
export function calculateObligations(recurringDebits) {
  if (!recurringDebits || recurringDebits.length === 0) return { total: 0, items: [] }
  const items = []
  for (const d of recurringDebits) {
    if (d.isObligation !== false) {
      const amt = toRupees(toPaise(d.amount || 0))
      items.push({
        label: d.label || '',
        amount: amt,
        kind: d.kind || 'LOAN_EMI',
        source: d.source,
      })
    }
  }
  return { total: sumRupees(items.map((i) => i.amount)), items }
}

function mean(xs) {
  if (!xs || xs.length === 0) return 0
  const totalPaise = xs.reduce((acc, x) => acc + toPaise(x), 0)
  return toRupees(Math.round(roundHalfUp(totalPaise / xs.length, 0)))
}

function coefficientOfVariation(xs) {
  if (!xs || xs.length < 2) return 0
  const m = mean(xs)
  if (!(m > 0)) return 0
  const variance = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length
  return roundHalfUp(Math.sqrt(variance) / m, 4)
}

/**
 * Recognised (verified) monthly income using conservative lower-of rule.
 */
export function calculateVerifiedIncome(inputData, rules) {
  const credits = (inputData.monthlyBankCredits || []).map((v) => toRupees(toPaise(v)))
  const cash = (inputData.monthlyCashDeposits || []).map((v) => toRupees(toPaise(v)))
  const platform = (inputData.monthlyPlatformNet || []).map((v) => toRupees(toPaise(v)))
  const window = rules.observation_window_months || 6

  const monthsObserved = credits.length
  const recentCredits = credits.slice(-window)
  const recentCash = cash.slice(-window)
  const recentPlatform = platform.slice(-window)

  const meanCredits = mean(recentCredits)
  const meanCash = mean(recentCash)

  const cashHaircutRate = rules.cash_deposit_haircut || 0
  const maxCashShare = rules.max_cash_share_of_income || 1
  const platformHaircutRate = rules.platform_earnings_haircut || 0

  const cashAfterHaircut = roundHalfUp(meanCash * (1 - cashHaircutRate), 2)
  const bankedNonCash = roundHalfUp(Math.max(meanCredits - meanCash, 0), 2)
  const denom = Math.max(1 - maxCashShare, 0.0001)
  const cashCap = roundHalfUp((bankedNonCash * maxCashShare) / denom, 2)
  const cashAdmitted = roundHalfUp(Math.min(cashAfterHaircut, cashCap), 2)
  const bankView = roundHalfUp(bankedNonCash + cashAdmitted, 2)

  const meanPlatform = platform.length > 0 ? mean(recentPlatform) : 0
  const platformView =
    platform.length > 0 ? roundHalfUp(meanPlatform * (1 - platformHaircutRate), 2) : null

  const verified = platformView === null ? bankView : roundHalfUp(Math.min(bankView, platformView), 2)

  return {
    verified_monthly_income: verified,
    method: rules.method || 'LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET',
    months_observed: monthsObserved,
    window_months: window,
    bank_view: bankView,
    platform_view: platformView,
    components: {
      mean_monthly_credits: roundHalfUp(meanCredits, 2),
      mean_monthly_cash: roundHalfUp(meanCash, 2),
      cash_after_haircut: cashAfterHaircut,
      cash_admitted: cashAdmitted,
      banked_non_cash: bankedNonCash,
      mean_platform_settlement: roundHalfUp(meanPlatform, 2),
      platform_haircut: platformHaircutRate,
      cash_haircut: cashHaircutRate,
    },
    volatility: coefficientOfVariation(recentCredits),
  }
}

/**
 * Single entry point for deterministic credit calculation.
 */
export function computeCreditMetrics({ evidence, loanRequest, policy }) {
  const segmentCode = loanRequest.segment
  const segment = (policy.segments || {})[segmentCode]
  if (!segment) throw new Error(`Unknown asset segment: ${segmentCode}`)

  let rate = loanRequest.rateAnnualPct
  if (rate == null) rate = segment.rate_annual_pct || 15

  const tenure = Math.round(Number(loanRequest.tenureMonths || 0))
  const amount = toRupees(toPaise(loanRequest.amount || 0))

  const bankEv = evidence.bank || {}
  const platformEv = evidence.platform || null
  const invoiceEv = evidence.invoice || {}
  const applicantEv = evidence.applicant || {}

  const income = calculateVerifiedIncome(
    {
      monthlyBankCredits: bankEv.monthly_credits,
      monthlyCashDeposits: bankEv.monthly_cash_deposits,
      monthlyPlatformNet: platformEv ? platformEv.monthly_net : null,
    },
    policy.income_recognition || {},
  )

  const obligations = calculateObligations(bankEv.recurring_debits || [])
  const emi = calculateEmi(amount, rate, tenure)
  const ratioDp = (policy.rounding || {}).ratio_dp || 4
  const foir = calculateFoir(income.verified_monthly_income, obligations.total, emi, ratioDp)

  const invoiceValue = toRupees(toPaise(invoiceEv.on_road_price || 0))
  const altVal = invoiceEv.assessed_value
  const altValue = altVal != null ? toRupees(toPaise(altVal)) : null
  const assetValue = altValue === null ? invoiceValue : Math.min(invoiceValue, altValue)
  const ltv = calculateLtv(amount, assetValue, ratioDp)

  const schedule = amortisationSchedule(amount, rate, tenure)
  const disposable = roundHalfUp(income.verified_monthly_income - obligations.total - emi, 2)

  const appAge = applicantEv.age
  const ageAtMaturity = appAge != null ? roundHalfUp(appAge + tenure / 12, 1) : null

  const inputs = {
    verified_monthly_income: income.verified_monthly_income,
    existing_obligations: obligations.total,
    loan_amount: amount,
    tenure_months: tenure,
    rate_annual_pct: rate,
    asset_value: assetValue,
    invoice_on_road_price: invoiceValue,
    assessed_value: altValue,
    months_observed: income.months_observed,
  }

  return {
    engine_version: ENGINE_VERSION,
    inputs,
    metrics: {
      emi,
      foir,
      ltv,
      obligations: obligations.total,
      verified_monthly_income: income.verified_monthly_income,
      disposable_income: disposable,
      income_volatility: income.volatility,
      income_months_observed: income.months_observed,
      average_monthly_balance: roundHalfUp(bankEv.average_monthly_balance || 0, 2),
      bounce_count: bankEv.bounce_count || 0,
      applicant_age: appAge,
      age_at_maturity: ageAtMaturity,
      total_interest: schedule.totalInterest,
      total_payable: schedule.totalPayable,
      loan_amount: amount,
      tenure_months: tenure,
    },
    income_breakdown: income,
    obligation_breakdown: obligations,
    schedule: schedule.rows,
    input_hash: hashValue(inputs),
  }
}

/* ------------------------------------------------------------------ *
 * Evidence strength
 * ------------------------------------------------------------------ */

/**
 * How much of the borrower's story the file actually supports, 0–100.
 *
 * This is NOT a credit score and it decides nothing. FOIR, LTV and the policy
 * rules answer "can this person repay"; evidence strength answers the question
 * a loan officer asks first and no other number on the screen answers: "how
 * much of this file do I actually know?"
 *
 * Four components of 25, every one of them a fact already extracted:
 *
 *   Corroboration  independent sources that support the income figure, and
 *                  whether they agree inside the policy's own tolerance
 *   Confidence     how far the critical fields sit above the policy's floor
 *   Consistency    what cross-document reconciliation found
 *   Coverage       which required documents produced fields, and how many
 *                  months of history they carry
 *
 * Every threshold is read from the policy document, so a lender that moves a
 * cutoff moves this score too — no constant here is invented by the engine.
 *
 * Pure: same bundle, same policy, same score, forever.
 *
 * @param {object} args
 * @param {object} args.fields         confidence-scored evidence fields, by path
 * @param {object} args.values         the same evidence, materialised
 * @param {object} args.reconciliation summarised findings
 * @param {object} args.policy         parsed policy document
 */
export function computeEvidenceStrength({ fields = {}, values = {}, reconciliation = null, policy = {} }) {
  const confidence = policy.confidence || {}
  const recon = policy.reconciliation || {}
  const recognition = policy.income_recognition || {}

  const criticalPaths = confidence.critical_fields || []
  const criticalFloor = confidence.critical_field_threshold ?? 0.88
  const window = recognition.observation_window_months ?? 6

  const fieldList = Object.values(fields)
  const bank = values.bank || {}
  const platform = values.platform || null

  /* -- corroboration: does more than one source say the same thing? ---- */
  const bankMonths = (bank.monthly_credits || []).length
  const platformMonths = platform ? (platform.monthly_net || []).length : 0
  const bankMean = meanOf(bank.monthly_credits || [])
  const platformMean = platform ? meanOf(platform.monthly_net || []) : 0

  let corroboration = 0
  const sources = []
  if (bankMonths > 0) {
    corroboration += 10
    sources.push('bank')
  }
  if (platformMonths > 0) {
    corroboration += 10
    sources.push('platform')
  }

  // Two sources that disagree are not two sources. The tolerance is the same
  // one reconciliation uses, so this can never contradict the findings below.
  let agreementGap = null
  if (bankMean > 0 && platformMean > 0) {
    agreementGap = roundHalfUp(Math.abs(platformMean - bankMean) / Math.max(bankMean, platformMean), 4)
    const advisoryPct = (recon.platform_vs_bank_credits || {}).advisory_pct ?? 0.12
    if (agreementGap <= advisoryPct) corroboration += 5
  }

  /* -- confidence: how far above the floor did the critical fields land? */
  const critical = fieldList.filter((f) => criticalPaths.includes(f.path) || f.critical)
  const meanCritical = critical.length
    ? roundHalfUp(critical.reduce((a, f) => a + Number(f.confidence || 0), 0) / critical.length, 4)
    : 0
  // Floor earns nothing, certainty earns everything; below the floor earns nothing.
  const span = Math.max(1 - criticalFloor, 0.0001)
  const confidencePoints = clampPoints(((meanCritical - criticalFloor) / span) * 25)

  /* -- consistency: a blocking finding is not a deduction, it is the story */
  const blocking = reconciliation ? reconciliation.blocking || 0 : 0
  const advisory = reconciliation ? reconciliation.advisory || 0 : 0
  const checksRun = reconciliation ? reconciliation.total || 0 : 0
  // Nothing to contradict is not the same as nothing contradicting. A bundle
  // that supported no cross-document check earns nothing here.
  const consistency = checksRun === 0 ? 0 : clampPoints(25 - blocking * 25 - advisory * 5)

  /* -- coverage: required documents, and how much history they carry ---- */
  const groups = [
    ['applicant', 'KYC'],
    ['bank', 'Bank statement'],
    ['invoice', 'Dealer invoice'],
  ]
  const present = groups.filter(([prefix]) => fieldList.some((f) => f.path.startsWith(`${prefix}.`)))
  const docPoints = (present.length / groups.length) * 15

  const observed = Math.max(bankMonths, platformMonths)
  const historyPoints = (Math.min(observed, window) / window) * 10
  const coverage = clampPoints(docPoints + historyPoints)

  const components = [
    {
      key: 'corroboration',
      label: 'Corroboration',
      points: clampPoints(corroboration),
      max: 25,
      detail:
        sources.length > 1
          ? `${sources.length} independent income sources${agreementGap === null ? '' : `, ${pctText(agreementGap)} apart`}`
          : sources.length === 1
            ? 'A single income source'
            : 'No observable income source',
    },
    {
      key: 'confidence',
      label: 'Confidence',
      points: confidencePoints,
      max: 25,
      detail: `${critical.length} critical fields, mean ${pctText(meanCritical)} against a ${pctText(criticalFloor)} floor`,
    },
    {
      key: 'consistency',
      label: 'Consistency',
      points: consistency,
      max: 25,
      detail:
        checksRun === 0
          ? 'No cross-document check was possible'
          : blocking > 0
            ? `${blocking} blocking contradiction${blocking === 1 ? '' : 's'}`
            : advisory > 0
              ? `${advisory} advisory finding${advisory === 1 ? '' : 's'}`
              : `All ${checksRun} cross-document checks agreed`,
    },
    {
      key: 'coverage',
      label: 'Coverage',
      points: coverage,
      max: 25,
      detail: `${present.length}/${groups.length} required document types, ${observed} of ${window} months observed`,
    },
  ]

  const score = Math.round(components.reduce((a, c) => a + c.points, 0))

  return {
    score,
    band: bandFor(score),
    components,
    inputs: {
      income_sources: sources.length,
      source_gap: agreementGap,
      critical_fields: critical.length,
      mean_critical_confidence: meanCritical,
      critical_floor: criticalFloor,
      blocking_findings: blocking,
      advisory_findings: advisory,
      checks_run: checksRun,
      document_groups_present: present.length,
      months_observed: observed,
      observation_window: window,
    },
  }
}

/** STRONG ≥ 80 · ADEQUATE ≥ 60 · THIN ≥ 40 · WEAK below that. */
export function bandFor(score) {
  if (score >= 80) return 'STRONG'
  if (score >= 60) return 'ADEQUATE'
  if (score >= 40) return 'THIN'
  return 'WEAK'
}

function clampPoints(n) {
  return roundHalfUp(Math.max(0, Math.min(25, Number(n) || 0)), 2)
}

function meanOf(xs) {
  if (!xs || !xs.length) return 0
  return roundHalfUp(xs.reduce((a, b) => a + Number(b || 0), 0) / xs.length, 2)
}

function pctText(ratio) {
  // Rounded by the shared helper, then padded to one decimal so this string is
  // byte-identical to the Python engine's. `88%` and `88.0%` are the same
  // number and two different records.
  return `${roundHalfUp(Number(ratio || 0) * 100, 1).toFixed(1)}%`
}
