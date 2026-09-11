/**
 * RECALLER — deterministic credit engine.
 *
 * This module is the ONLY place in the system permitted to produce EMI, FOIR,
 * LTV, obligation totals or recognised income. No language model output reaches
 * these functions except as already-extracted, already-confidence-gated field
 * values. Every function is pure: same inputs, same outputs, forever.
 */

import { round, toPaise, toRupees, sum } from '../../core/src/money.js';
import { hashValue } from '../../core/src/hash.js';
import { ENGINE_VERSION } from '../../core/src/constants.js';

/**
 * Equated Monthly Instalment on a reducing-balance loan.
 *
 *   EMI = P · r · (1+r)^n / ((1+r)^n − 1),  r = annual rate / 12 / 100
 *
 * Zero-rate loans degrade to straight-line principal repayment.
 * @param {number} principal rupees
 * @param {number} annualRatePct e.g. 16.5
 * @param {number} tenureMonths
 * @returns {number} rupees, 2dp
 */
export function calculateEMI(principal, annualRatePct, tenureMonths) {
  const P = toRupees(toPaise(principal));
  const n = Math.round(Number(tenureMonths));
  if (!(P > 0) || !(n > 0)) return 0;
  const r = Number(annualRatePct) / 12 / 100;
  if (r === 0) return round(P / n, 2);
  const growth = (1 + r) ** n;
  return round((P * r * growth) / (growth - 1), 2);
}

/**
 * Full amortisation schedule. Interest is computed on the opening balance each
 * month; the final instalment absorbs the rounding residue so the schedule
 * closes at exactly zero.
 */
export function amortisationSchedule(principal, annualRatePct, tenureMonths) {
  const emi = calculateEMI(principal, annualRatePct, tenureMonths);
  const n = Math.round(Number(tenureMonths));
  const r = Number(annualRatePct) / 12 / 100;
  let balancePaise = toPaise(principal);
  const rows = [];
  for (let m = 1; m <= n; m += 1) {
    const opening = balancePaise;
    const interest = Math.round(opening * r);
    let payment = toPaise(emi);
    let principalPart = payment - interest;
    if (m === n || principalPart >= opening) {
      principalPart = opening;
      payment = principalPart + interest;
    }
    balancePaise = opening - principalPart;
    rows.push({
      month: m,
      opening: toRupees(opening),
      payment: toRupees(payment),
      interest: toRupees(interest),
      principal: toRupees(principalPart),
      closing: toRupees(balancePaise),
    });
    if (balancePaise <= 0) break;
  }
  const totalInterest = toRupees(rows.reduce((a, x) => a + toPaise(x.interest), 0));
  return { emi, rows, totalInterest, totalPayable: round(toRupees(toPaise(principal)) + totalInterest, 2) };
}

/**
 * Fixed Obligation to Income Ratio.
 *   FOIR = (existing monthly obligations + proposed EMI) / verified monthly income
 * Returns a ratio (0.42), not a percentage.
 */
export function calculateFOIR(verifiedMonthlyIncome, existingObligations, proposedEMI, ratioDp = 4) {
  const income = toRupees(toPaise(verifiedMonthlyIncome));
  if (!(income > 0)) return null;
  const outflow = toRupees(toPaise(existingObligations) + toPaise(proposedEMI));
  return round(outflow / income, ratioDp);
}

/**
 * Loan to Value.
 *   LTV = sanctioned amount / asset value
 * Asset value is the LOWER of invoice on-road price and any independently
 * evidenced valuation — the conservative choice, stated explicitly.
 */
export function calculateLTV(loanAmount, assetValue, ratioDp = 4) {
  const value = toRupees(toPaise(assetValue));
  if (!(value > 0)) return null;
  return round(toRupees(toPaise(loanAmount)) / value, ratioDp);
}

/**
 * Total existing monthly obligations from classified recurring debits.
 * Only debits the extraction layer tagged as obligations are counted; each is
 * returned alongside the total so the officer can see the build-up.
 */
export function calculateObligations(recurringDebits = []) {
  const items = recurringDebits
    .filter((d) => d.isObligation !== false)
    .map((d) => ({
      label: d.label,
      amount: toRupees(toPaise(d.amount)),
      kind: d.kind ?? 'LOAN_EMI',
      source: d.source ?? null,
    }));
  return { total: sum(items.map((i) => i.amount)), items };
}

/**
 * Recognised (verified) monthly income.
 *
 * Policy method LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET takes the more
 * conservative of two independent views, after haircuts:
 *   - bank view: mean monthly qualifying credits, with cash deposits haircut
 *     and capped as a share of total income
 *   - platform view: mean monthly platform settlement, haircut for churn
 *
 * @param {object} input
 * @param {number[]} input.monthlyBankCredits per-month qualifying credits
 * @param {number[]} [input.monthlyCashDeposits] per-month cash-in
 * @param {number[]} [input.monthlyPlatformNet] per-month platform settlements
 * @param {object} rules policy.income_recognition
 */
export function calculateVerifiedIncome(input, rules) {
  const credits = (input.monthlyBankCredits ?? []).map((v) => toRupees(toPaise(v)));
  const cash = (input.monthlyCashDeposits ?? []).map((v) => toRupees(toPaise(v)));
  const platform = (input.monthlyPlatformNet ?? []).map((v) => toRupees(toPaise(v)));
  const window = rules.observation_window_months ?? 6;

  const monthsObserved = credits.length;
  const meanCredits = mean(credits.slice(-window));
  const meanCash = mean(cash.slice(-window));

  // Cash is discounted, then capped at its permitted share of recognised income.
  const cashAfterHaircut = round(meanCash * (1 - (rules.cash_deposit_haircut ?? 0)), 2);
  const bankedNonCash = round(Math.max(meanCredits - meanCash, 0), 2);
  const cashCap = round((bankedNonCash * (rules.max_cash_share_of_income ?? 1)) / Math.max(1 - (rules.max_cash_share_of_income ?? 0), 0.0001), 2);
  const cashAdmitted = round(Math.min(cashAfterHaircut, cashCap), 2);
  const bankView = round(bankedNonCash + cashAdmitted, 2);

  const meanPlatform = mean(platform.slice(-window));
  const platformView = platform.length
    ? round(meanPlatform * (1 - (rules.platform_earnings_haircut ?? 0)), 2)
    : null;

  const verified =
    platformView === null ? bankView : round(Math.min(bankView, platformView), 2);

  return {
    verified_monthly_income: verified,
    method: rules.method ?? 'LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET',
    months_observed: monthsObserved,
    window_months: window,
    bank_view: bankView,
    platform_view: platformView,
    components: {
      mean_monthly_credits: round(meanCredits, 2),
      mean_monthly_cash: round(meanCash, 2),
      cash_after_haircut: cashAfterHaircut,
      cash_admitted: cashAdmitted,
      banked_non_cash: bankedNonCash,
      mean_platform_settlement: round(meanPlatform, 2),
      platform_haircut: rules.platform_earnings_haircut ?? 0,
      cash_haircut: rules.cash_deposit_haircut ?? 0,
    },
    volatility: coefficientOfVariation(credits.slice(-window)),
  };
}

function mean(xs) {
  if (!xs.length) return 0;
  return toRupees(Math.round(xs.reduce((a, x) => a + toPaise(x), 0) / xs.length));
}

/** Coefficient of variation — standard deviation over mean. Ratio, 4dp. */
export function coefficientOfVariation(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  if (!(m > 0)) return 0;
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length;
  return round(Math.sqrt(variance) / m, 4);
}

/**
 * The single entry point the workflow calls. Takes gated evidence plus the
 * loan request and returns every credit metric, each traceable to its inputs.
 *
 * @param {object} args
 * @param {object} args.evidence    validated evidence values (see packages/extraction)
 * @param {object} args.loanRequest { amount, tenureMonths, segment }
 * @param {object} args.policy      parsed policy document
 */
export function computeCreditMetrics({ evidence, loanRequest, policy }) {
  const segment = policy.segments[loanRequest.segment];
  if (!segment) throw new Error(`Unknown asset segment: ${loanRequest.segment}`);

  const rate = loanRequest.rateAnnualPct ?? segment.rate_annual_pct;
  const tenure = Math.round(loanRequest.tenureMonths);
  const amount = toRupees(toPaise(loanRequest.amount));

  const income = calculateVerifiedIncome(
    {
      monthlyBankCredits: evidence.bank.monthly_credits,
      monthlyCashDeposits: evidence.bank.monthly_cash_deposits,
      monthlyPlatformNet: evidence.platform?.monthly_net ?? null,
    },
    policy.income_recognition,
  );

  const obligations = calculateObligations(evidence.bank.recurring_debits ?? []);
  const emi = calculateEMI(amount, rate, tenure);
  const foir = calculateFOIR(income.verified_monthly_income, obligations.total, emi, policy.rounding.ratio_dp);

  // Conservative asset value: the lower of the invoice on-road price and any
  // independent valuation the bundle carries.
  const invoiceValue = toRupees(toPaise(evidence.invoice.on_road_price));
  const altValue = evidence.invoice.assessed_value ? toRupees(toPaise(evidence.invoice.assessed_value)) : null;
  const assetValue = altValue === null ? invoiceValue : Math.min(invoiceValue, altValue);
  const ltv = calculateLTV(amount, assetValue, policy.rounding.ratio_dp);

  const schedule = amortisationSchedule(amount, rate, tenure);
  const disposable = round(income.verified_monthly_income - obligations.total - emi, 2);

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
  };

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
      average_monthly_balance: round(evidence.bank.average_monthly_balance ?? 0, 2),
      bounce_count: evidence.bank.bounce_count ?? 0,
      applicant_age: evidence.applicant.age ?? null,
      age_at_maturity: evidence.applicant.age == null ? null : round(evidence.applicant.age + tenure / 12, 1),
      total_interest: schedule.totalInterest,
      total_payable: schedule.totalPayable,
      loan_amount: amount,
      tenure_months: tenure,
    },
    income_breakdown: income,
    obligation_breakdown: obligations,
    schedule: schedule.rows,
    /** Fingerprint of the inputs — a replay that produces a different hash used different material. */
    input_hash: hashValue(inputs),
  };
}
