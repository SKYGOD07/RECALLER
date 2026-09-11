/**
 * RECALLER — deterministic engine tests.
 *
 *   node scripts/test-engine.mjs
 *
 * These pin the arithmetic. If a change here goes red, a credit decision has
 * moved, and every replay of every historical file is now suspect. Nothing in
 * this file depends on a network, a model, a clock or a random source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  calculateEMI,
  calculateFOIR,
  calculateLTV,
  calculateObligations,
  calculateVerifiedIncome,
  amortisationSchedule,
  coefficientOfVariation,
  computeCreditMetrics,
} from '../packages/credit-engine/src/index.js';
import { evaluatePolicy } from '../packages/policy-engine/src/index.js';
import { nameSimilarity, addressSimilarity } from '../packages/reconciliation/src/index.js';
import { toPaise, round, formatINR, sum } from '../packages/core/src/money.js';
import { hashValue, stableStringify, rng } from '../packages/core/src/hash.js';
import { createLedger, appendEvent, verifyLedger } from '../packages/core/src/audit.js';
import { solveMinimumChange } from '../packages/whatif/src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'policy/policy.v1.json'), 'utf8'));

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}

function ok(name, condition, detail = '') {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? `\n      ${detail}` : ''}`);
}

function near(name, actual, expected, tolerance = 0.01) {
  if (Math.abs(actual - expected) <= tolerance) passed += 1;
  else failures.push(`${name}\n      expected ~${expected} (±${tolerance})\n      actual    ${actual}`);
}

/* ================================================================== *
 * Money primitives
 * ================================================================== */

check('toPaise handles a plain number', toPaise(1234.56), 123456);
check('toPaise strips currency formatting', toPaise('₹1,23,456.78'), 12345678);
check('toPaise on empty is zero', toPaise(''), 0);
check('toPaise is symmetric about zero', toPaise(-10.005), -toPaise(10.005));
check('round is half-up, not banker\'s', round(2.345, 2), 2.35);
check('round handles the classic float case', round(1.005, 2), 1.01);
check('sum does not drift', sum([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]), 4.5);
check('formatINR groups the Indian way', formatINR(12345678), '₹1,23,45,678');
check('formatINR handles small values', formatINR(999), '₹999');
check('formatINR renders a dash for nothing', formatINR(null), '—');

/* ================================================================== *
 * EMI — checked against independently computed values
 * ================================================================== */

// ₹1,00,000 at 12% over 12 months is a standard textbook figure: ₹8,884.88
near('EMI 100000 @12% 12m', calculateEMI(100000, 12, 12), 8884.88, 0.01);
// ₹5,00,000 at 10% over 60 months: ₹10,623.52
near('EMI 500000 @10% 60m', calculateEMI(500000, 10, 60), 10623.52, 0.01);
// ₹95,000 at 16.5% over 36 months — the Rahul Sharma file. The expected value
// is 40-digit decimal arithmetic, not a float: 3363.41634225218262…
check('EMI 95000 @16.5% 36m', calculateEMI(95000, 16.5, 36), 3363.42);
check('EMI at zero rate is straight-line', calculateEMI(120000, 0, 12), 10000);
check('EMI of nothing is nothing', calculateEMI(0, 12, 12), 0);
check('EMI over zero months is nothing', calculateEMI(100000, 12, 0), 0);

ok(
  'EMI falls monotonically as tenure lengthens',
  [12, 24, 36, 48, 60].map((t) => calculateEMI(200000, 15, t)).every((v, i, a) => i === 0 || v < a[i - 1]),
);
ok(
  'EMI rises monotonically with principal',
  [50000, 100000, 150000].map((p) => calculateEMI(p, 15, 24)).every((v, i, a) => i === 0 || v > a[i - 1]),
);

/* ---- amortisation ------------------------------------------------ */
{
  const s = amortisationSchedule(95000, 16.5, 36);
  check('schedule runs the full term', s.rows.length, 36);
  check('schedule closes at exactly zero', s.rows[s.rows.length - 1].closing, 0);
  const principalPaid = sum(s.rows.map((r) => r.principal));
  check('principal repaid equals the advance', principalPaid, 95000);
  const interestPaid = sum(s.rows.map((r) => r.interest));
  check('reported interest matches the schedule', s.totalInterest, interestPaid);
  check('total payable is principal plus interest', s.totalPayable, round(95000 + interestPaid, 2));
  ok('interest declines over the term', s.rows[0].interest > s.rows[35].interest);
}

/* ================================================================== *
 * FOIR and LTV
 * ================================================================== */

check('FOIR is a ratio of outflow to income', calculateFOIR(50000, 10000, 5000), 0.3);
check('FOIR is null when income is zero', calculateFOIR(0, 1000, 1000), null);
check('FOIR with no obligations is EMI over income', calculateFOIR(40000, 0, 10000), 0.25);
check('LTV is advance over asset value', calculateLTV(85000, 100000), 0.85);
check('LTV is null when the asset is worthless', calculateLTV(85000, 0), null);

/* ---- obligations ------------------------------------------------- */
{
  const o = calculateObligations([
    { label: 'A', amount: 2400 },
    { label: 'B', amount: 3800.5 },
    { label: 'C', amount: 1000, isObligation: false },
  ]);
  check('obligations exclude anything flagged as not one', o.total, 6200.5);
  check('obligations keep their build-up', o.items.length, 2);
  check('empty obligations total zero', calculateObligations([]).total, 0);
}

/* ================================================================== *
 * Income recognition
 * ================================================================== */
{
  const rules = policy.income_recognition;
  const r = calculateVerifiedIncome(
    {
      monthlyBankCredits: [30000, 30000, 30000, 30000, 30000, 30000],
      monthlyCashDeposits: [6000, 6000, 6000, 6000, 6000, 6000],
      monthlyPlatformNet: null,
    },
    rules,
  );
  // banked non-cash 24000; cash after 50% haircut 3000; cap = 24000*0.3/0.7 = 10285.71
  check('cash is discounted then admitted under the cap', r.components.cash_admitted, 3000);
  check('bank view is non-cash plus admitted cash', r.bank_view, 27000);
  check('no platform statement leaves the bank view standing', r.platform_view, null);
  check('recognised income is the bank view', r.verified_monthly_income, 27000);

  const capped = calculateVerifiedIncome(
    {
      monthlyBankCredits: [30000, 30000, 30000, 30000, 30000, 30000],
      monthlyCashDeposits: [28000, 28000, 28000, 28000, 28000, 28000],
    },
    rules,
  );
  // non-cash 2000 → cap 857.14; haircut cash 14000 → admitted is the cap
  near('a cash-heavy file is capped, not haircut', capped.components.cash_admitted, 857.14, 0.02);

  const lower = calculateVerifiedIncome(
    {
      monthlyBankCredits: [40000, 40000, 40000, 40000, 40000, 40000],
      monthlyCashDeposits: [0, 0, 0, 0, 0, 0],
      monthlyPlatformNet: [30000, 30000, 30000, 30000, 30000, 30000],
    },
    rules,
  );
  check('the conservative of the two views is taken', lower.verified_monthly_income, 27000);
  check('the platform view carries its haircut', lower.platform_view, 27000);

  check('a flat series has no dispersion', coefficientOfVariation([100, 100, 100, 100]), 0);
  ok('a swinging series has dispersion', coefficientOfVariation([100, 20, 180, 40]) > 0.5);
  check('a single observation has no dispersion', coefficientOfVariation([100]), 0);
}

/* ================================================================== *
 * Determinism — the property the whole audit story rests on
 * ================================================================== */

check('stable stringify ignores key order', stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
check('equal values hash equally', hashValue({ x: [1, 2], y: 'z' }), hashValue({ y: 'z', x: [1, 2] }));
ok('different values hash differently', hashValue({ a: 1 }) !== hashValue({ a: 2 }));
check('hashes are 128 bits of hex', hashValue({ a: 1 }).length, 32);

{
  const a = rng('seed-one');
  const b = rng('seed-one');
  const c = rng('seed-two');
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  check('the same seed replays the same sequence', seqA, seqB);
  ok('a different seed diverges', JSON.stringify(seqA) !== JSON.stringify([c(), c(), c()]));
  ok('values stay in the unit interval', seqA.every((v) => v >= 0 && v < 1));
}

/* ---- the credit engine as a whole -------------------------------- */
{
  const evidence = {
    applicant: { age: 32, declared_monthly_income: 32000 },
    bank: {
      monthly_credits: [33200, 35100, 34400, 32800, 35600, 34900],
      monthly_cash_deposits: [5800, 6200, 5400, 6600, 5900, 6100],
      average_monthly_balance: 8500,
      bounce_count: 0,
      recurring_debits: [{ label: 'EMI', amount: 2400 }],
    },
    platform: { monthly_net: [32800, 34200, 33100, 32200, 34700, 33600] },
    invoice: { on_road_price: 118000 },
  };
  const loanRequest = { amount: 95000, tenureMonths: 36, segment: 'EV_2W' };

  const one = computeCreditMetrics({ evidence, loanRequest, policy });
  const two = computeCreditMetrics({ evidence, loanRequest, policy });
  check('the engine is a pure function', one.metrics, two.metrics);
  check('identical inputs fingerprint identically', one.input_hash, two.input_hash);

  const moved = computeCreditMetrics({ evidence, loanRequest: { ...loanRequest, amount: 95001 }, policy });
  ok('a changed input changes the fingerprint', moved.input_hash !== one.input_hash);

  check('FOIR is derived from the engine\'s own figures', one.metrics.foir,
    calculateFOIR(one.metrics.verified_monthly_income, one.metrics.obligations, one.metrics.emi, 4));
  check('age at maturity adds the term', one.metrics.age_at_maturity, 35);

  /* ---- policy precedence ---------------------------------------- */
  const clean = evaluatePolicy({
    metrics: one.metrics,
    reconciliation: { blocking: 0, advisory: 0 },
    unresolvedLowConfidence: 0,
    loanRequest,
    policy,
  });
  check('a clean file approves', clean.decision, 'APPROVE');

  const held = evaluatePolicy({
    metrics: one.metrics,
    reconciliation: { blocking: 0, advisory: 0 },
    unresolvedLowConfidence: 2,
    loanRequest,
    policy,
  });
  check('ungated evidence refers rather than approves', held.decision, 'REFER');
  ok('the referral names the confidence code', held.reason_codes.some((c) => c.code === 'F01'));

  const contradicted = evaluatePolicy({
    metrics: one.metrics,
    reconciliation: { blocking: 1, advisory: 0 },
    unresolvedLowConfidence: 0,
    loanRequest,
    policy,
  });
  check('a blocking contradiction rejects', contradicted.decision, 'REJECT');
  ok('the rejection names the contradiction code', contradicted.reason_codes.some((c) => c.code === 'R02'));

  const unaffordable = evaluatePolicy({
    metrics: { ...one.metrics, foir: 0.72 },
    reconciliation: { blocking: 0, advisory: 0 },
    unresolvedLowConfidence: 0,
    loanRequest,
    policy,
  });
  check('a FOIR breach rejects', unaffordable.decision, 'REJECT');
  ok('the rejection names the FOIR code', unaffordable.reason_codes.some((c) => c.code === 'R01'));

  const borderline = evaluatePolicy({
    metrics: { ...one.metrics, foir: 0.52 },
    reconciliation: { blocking: 0, advisory: 0 },
    unresolvedLowConfidence: 0,
    loanRequest,
    policy,
  });
  check('a FOIR inside the referral band refers', borderline.decision, 'REFER');

  // An advisory rule must never be able to reject on its own.
  const advisoryOnly = evaluatePolicy({
    metrics: { ...one.metrics, income_volatility: 0.95, average_monthly_balance: 10 },
    reconciliation: { blocking: 0, advisory: 0 },
    unresolvedLowConfidence: 0,
    loanRequest,
    policy,
  });
  check('advisory rules can refer but never reject', advisoryOnly.decision, 'REFER');

  ok('only the three permitted verdicts are ever emitted',
    [clean, held, contradicted, unaffordable, borderline, advisoryOnly]
      .every((e) => ['APPROVE', 'REFER', 'REJECT'].includes(e.decision)));

  /* ---- what-if exactness ---------------------------------------- */
  const evaluate = (scenario) => {
    const m = computeCreditMetrics({
      evidence,
      loanRequest: { ...loanRequest, amount: scenario.amount, tenureMonths: scenario.tenureMonths },
      policy,
    });
    const e = evaluatePolicy({
      metrics: m.metrics,
      reconciliation: { blocking: 0, advisory: 0 },
      unresolvedLowConfidence: 0,
      loanRequest: { ...loanRequest, amount: scenario.amount, tenureMonths: scenario.tenureMonths },
      policy,
    });
    return { decision: e.decision, metrics: m.metrics, evaluation: e };
  };

  // Over-fund the asset so LTV breaches, then ask for the minimum reduction.
  const over = { amount: 112000, tenureMonths: 36, coApplicantIncome: 0 };
  check('the over-funded scenario does breach', evaluate(over).decision, 'REJECT');
  const solved = solveMinimumChange({ evaluate, baseScenario: over, policy, segment: 'EV_2W' });
  const lever = solved.levers.find((l) => l.id === 'LOAN_AMOUNT');
  ok('the amount lever is feasible', lever.feasible);
  check('the solved amount approves', evaluate(lever.scenario).decision, 'APPROVE');
  ok(
    'the solution is the exact edge — one step more would not approve',
    evaluate({ ...lever.scenario, amount: lever.to + 500 }).decision !== 'APPROVE',
    `to=${lever.to}, next step ${lever.to + 500} gave ${evaluate({ ...lever.scenario, amount: lever.to + 500 }).decision}`,
  );
}

/* ================================================================== *
 * Reconciliation similarity
 * ================================================================== */

check('identical names match exactly', nameSimilarity('Rahul Sharma', 'RAHUL SHARMA'), 1);
ok('reordered names still match', nameSimilarity('Rahul Sharma', 'Sharma Rahul') > 0.95);
ok('an initial stands in for the word', nameSimilarity('Vikram Singh Rathore', 'Vikram S Rathore') > 0.85);
ok('a dropped middle name is tolerated', nameSimilarity('Vikram Singh Rathore', 'Vikram Rathore') > 0.85);
ok('a minor spelling variant is tolerated', nameSimilarity('Lakshmi Narayanan', 'Lakshmi Narayan') > 0.88);
ok('a different person does not match', nameSimilarity('Lakshmi Narayanan', 'Suresh Kumar Ramasamy') < 0.7);
check('an empty name matches nothing', nameSimilarity('', 'Rahul Sharma'), 0);

ok(
  'an abbreviated statement address still agrees',
  addressSimilarity('8-3-214, Nalgonda X Roads, Malakpet, Hyderabad 500036', 'Malakpet, Hyderabad 500036') > 0.9,
);
ok(
  'a different city does not agree',
  addressSimilarity('22/4 Cross Cut Road, Gandhipuram, Coimbatore 641012', 'No 5, Perundurai Main Road, Erode 638052') < 0.5,
);

/* ================================================================== *
 * Audit ledger
 * ================================================================== */
{
  let l = createLedger('TRC-TEST');
  l = appendEvent(l, { stage: 'APPLICATION_CREATED', actor: 'OFFICER', summary: 'one', at: '2026-01-01T00:00:00.000Z' });
  l = appendEvent(l, { stage: 'DECISION', actor: 'ENGINE', summary: 'two', at: '2026-01-01T00:00:01.000Z' });
  check('the ledger holds what was appended', l.events.length, 2);
  check('a clean chain verifies', verifyLedger(l).ok, true);
  check('each event links to its predecessor', l.events[1].prev, l.events[0].digest);
  check('the head is the last digest', l.head, l.events[1].digest);

  const tampered = { ...l, events: [{ ...l.events[0], summary: 'edited' }, l.events[1]] };
  check('editing an event breaks verification', verifyLedger(tampered).ok, false);
  check('the break is located', verifyLedger(tampered).brokenAt, 0);

  const dropped = { ...l, events: [l.events[1]] };
  check('dropping an event breaks verification', verifyLedger(dropped).ok, false);
}

/* ================================================================== *
 * Policy document integrity
 * ================================================================== */

ok('every rule declares a severity', policy.rules.every((r) => ['BLOCKING', 'ADVISORY'].includes(r.severity)));
ok(
  'every reason a rule can emit is defined in the codebook',
  policy.rules.every((r) =>
    [r.reject_reason, r.refer_reason, r.pass_reason]
      .filter(Boolean)
      .every((c) => policy.reason_codes[c] !== undefined),
  ),
);
ok('rule codes are unique', new Set(policy.rules.map((r) => r.code)).size === policy.rules.length);
ok(
  'referral bands sit on the permissive side of their threshold',
  policy.rules
    .filter((r) => r.refer_band && r.operator === 'lte')
    .every((r) => r.refer_band[0] >= r.threshold),
);
ok(
  'no advisory rule carries a reject code',
  policy.rules.filter((r) => r.severity === 'ADVISORY').every((r) => !r.reject_reason),
);
ok(
  'every product band is coherent',
  Object.values(policy.segments).every(
    (s) => s.min_ticket < s.max_ticket && s.tenure_months.min < s.tenure_months.max && s.rate_annual_pct > 0,
  ),
);
ok(
  'the critical confidence floor is stricter than the standard one',
  policy.confidence.critical_field_threshold > policy.confidence.field_threshold,
);

/* ================================================================== */

const total = passed + failures.length;
if (failures.length) {
  console.log(`\n${failures.length} of ${total} checks failed:\n`);
  failures.forEach((f) => console.log(`  ✗ ${f}\n`));
  process.exit(1);
}
console.log(`\nAll ${total} engine checks passed.\n`);
