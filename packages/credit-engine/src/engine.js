/**
 * RECALLER — deterministic credit calculation engine.
 *
 * JavaScript port of recaller/credit_engine/engine.py.
 * This module is the ONLY place in the system permitted to produce EMI, FOIR,
 * LTV, obligation totals or recognised income. Every function is pure: same
 * inputs, same outputs, forever.
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
