/**
 * RECALLER — deterministic engine unit tests.
 *
 *   node --import ./scripts/alias.mjs --test scripts/test-engine.mjs
 *
 * These cover the JavaScript domain packages the console imports directly.
 * They are the counterpart to tests/ on the Python side, and the two
 * implementations are expected to agree figure for figure.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { URL } from 'node:url'

import { DOC_TYPES, PROVENANCE } from '@core/constants.js'
import {
  calculateEmi,
  calculateFoir,
  calculateLtv,
  calculateObligations,
  computeCreditMetrics,
  reconcileInformantObligation,
} from '@credit-engine/engine.js'
import {
  applyConfidenceGate,
  applyOfficerResolutions,
  fixtureAdapter,
  materialise,
} from '@extraction/adapters.js'
import {
  ARITHMETIC_PATHS,
  attestationQuality,
  completeness,
  ledgerCoherence,
} from '@extraction/informant.js'
import { SPEC_BY_PATH } from '@extraction/schema.js'
import { evaluatePolicy } from '@policy-engine/engine.js'
import { nameSimilarity, reconcile } from '@reconciliation/reconcile.js'

const POLICY = JSON.parse(
  await readFile(new URL('../policy/policy.v1.json', import.meta.url), 'utf8')
)

const COHERENT = {
  name: 'Suresh Kumar Gupta',
  relationship: 'SHOPKEEPER_CREDIT',
  business_name: 'Gupta General Store',
  contact: '98XXXXXX07',
  contact_verified: true,
  borrower_known_as: 'Rahul Sharma',
  months_known: 34,
  principal_lent: 45000,
  current_outstanding: 12000,
  monthly_repayment: 3000,
  missed_payments_12m: 1,
  longest_delay_days: 6,
  would_lend_again: true,
  attested_at: '2026-08-28',
}

const BASE_EVIDENCE = {
  bank: {
    monthly_credits: [30000, 30000, 30000, 30000, 30000, 30000],
    monthly_cash_deposits: [0, 0, 0, 0, 0, 0],
    recurring_debits: [],
    average_monthly_balance: 9000,
    bounce_count: 0,
  },
  invoice: { on_road_price: 100000 },
  applicant: { age: 30 },
}
const LOAN = { amount: 80000, tenureMonths: 36, segment: 'EV_2W' }

/* ------------------------------------------------------------ arithmetic */

test('EMI matches the closed-form reducing-balance formula', () => {
  // 100000 at 15% over 24 months
  assert.equal(calculateEmi(100000, 15, 24), 4849.21)
  assert.equal(calculateEmi(0, 15, 24), 0)
  assert.equal(calculateEmi(100000, 15, 0), 0)
})

test('zero-rate EMI is a straight division', () => {
  assert.equal(calculateEmi(120000, 0, 12), 10000)
})

test('FOIR is undefined without income rather than zero', () => {
  assert.equal(calculateFoir(0, 1000, 1000), null)
  assert.equal(calculateFoir(50000, 5000, 5000), 0.2)
})

test('LTV is undefined without an asset value', () => {
  assert.equal(calculateLtv(80000, 0), null)
  assert.equal(calculateLtv(80000, 100000), 0.8)
})

test('obligations exclude debits explicitly marked as not obligations', () => {
  const out = calculateObligations([
    { label: 'EMI', amount: 2400 },
    { label: 'SIP', amount: 5000, isObligation: false },
  ])
  assert.equal(out.total, 2400)
  assert.equal(out.items.length, 1)
})

/* ------------------------------------------------- informant confidence */

test('informant fields are typed and marked attested', () => {
  const paths = Object.keys(SPEC_BY_PATH).filter((p) => p.startsWith('informant.'))
  assert.ok(paths.length >= 12)
  for (const p of paths) {
    assert.equal(SPEC_BY_PATH[p].doc, DOC_TYPES.INFORMANT_REFERENCE, p)
    assert.equal(SPEC_BY_PATH[p].attested, true, p)
  }
  assert.equal(SPEC_BY_PATH['informant.monthly_repayment'].type, 'money')
  assert.equal(SPEC_BY_PATH['informant.months_known'].type, 'number')
  assert.equal(SPEC_BY_PATH['informant.contact_verified'].type, 'flag')
})

test('confidence is a function of the evidence, not a constant', () => {
  const scores = new Set()
  for (const mutation of [
    {},
    { contact_verified: false },
    { months_known: 2 },
    { relationship: 'FAMILY' },
    { current_outstanding: 90000 },
    { missed_payments_12m: null, attested_at: null, contact: null },
  ]) {
    scores.add(attestationQuality({ ...COHERENT, ...mutation }, POLICY).ledger_confidence)
  }
  assert.ok(scores.size >= 6, `confidence barely moves: ${[...scores]}`)
})

test('the same reference always scores the same', () => {
  const a = attestationQuality(COHERENT, POLICY)
  const b = attestationQuality(JSON.parse(JSON.stringify(COHERENT)), POLICY)
  assert.deepEqual(a, b)
})

test('confidence never exceeds the policy ceiling', () => {
  const q = attestationQuality(COHERENT, POLICY)
  const ceiling = POLICY.confidence.informant.source_confidence_ceiling
  assert.ok(q.identity_confidence <= ceiling)
  assert.ok(q.ledger_confidence <= ceiling)
  assert.ok(q.conduct_confidence <= ceiling)
})

test('a coherent ledger has no problems', () => {
  const c = ledgerCoherence(COHERENT, POLICY)
  assert.deepEqual(c.problems, [])
  assert.equal(c.score, 1)
  assert.equal(c.implied_months_repaid, 11)
})

test('repayment outrunning the relationship is caught', () => {
  const c = ledgerCoherence(
    { ...COHERENT, principal_lent: 60000, current_outstanding: 0, monthly_repayment: 4000, months_known: 9 },
    POLICY
  )
  assert.ok(c.problems.some((p) => p.code === 'REPAYMENT_EXCEEDS_RELATIONSHIP'))
  assert.ok(c.arithmetic_score < 1)
})

test('an arithmetic contradiction does not discredit conduct fields', () => {
  const c = ledgerCoherence(
    { ...COHERENT, current_outstanding: 90000 },
    POLICY
  )
  assert.ok(c.arithmetic_score < 1)
  assert.equal(c.conduct_score, 1)
})

test('incomplete references score lower', () => {
  const partial = { name: COHERENT.name, relationship: COHERENT.relationship }
  assert.ok(completeness(partial) < completeness(COHERENT))
})

/* -------------------------------------------------------- provenance */

function informantFields(informant, policy = POLICY) {
  return fixtureAdapter.extract(
    {
      id: 'D1',
      type: DOC_TYPES.INFORMANT_REFERENCE,
      filename: 'InformantReference.pdf',
      payload: { informant },
      pageMap: {},
    },
    'seed',
    policy
  )
}

test('every informant field carries provenance and a citation', () => {
  const fields = informantFields(COHERENT)
  assert.ok(Object.keys(fields).length > 0)
  for (const [path, f] of Object.entries(fields)) {
    assert.equal(f.provenance, PROVENANCE.INFORMANT, path)
    assert.equal(f.citation.document, 'InformantReference.pdf', path)
    assert.equal(f.attested, true, path)
    assert.ok(f.attestation.coherence, path)
  }
})

test('the attestation travels with the values into the engines', () => {
  const values = materialise(informantFields(COHERENT))
  assert.ok(values.informant._attestation)
  assert.equal(values.informant._attestation.coherence.score, 1)
})

/* ------------------------------------------------------ confidence gate */

test('a sound reference clears the attested floor', () => {
  const gate = applyConfidenceGate(informantFields(COHERENT), POLICY)
  assert.deepEqual(gate.held.filter((h) => h.path.startsWith('informant.')), [])
})

test('an incoherent reference is held for an officer', () => {
  const bad = {
    ...COHERENT,
    principal_lent: 60000,
    current_outstanding: 0,
    monthly_repayment: 4000,
    months_known: 9,
    contact_verified: false,
  }
  const gate = applyConfidenceGate(informantFields(bad), POLICY)
  const held = gate.held.map((h) => h.path)
  assert.ok(held.includes('informant.monthly_repayment'))
  assert.ok(held.includes('informant.current_outstanding'))
  assert.equal(gate.passed, false)
})

test('held attested fields explain themselves', () => {
  const gate = applyConfidenceGate(informantFields({ ...COHERENT, current_outstanding: 900000 }), POLICY)
  assert.ok(gate.held.some((h) => (h.reason || '').includes('does not add up')))
})

test('thresholds come from policy, not from code', () => {
  const strict = JSON.parse(JSON.stringify(POLICY))
  strict.confidence.attested_critical_field_threshold = 0.99
  const gate = applyConfidenceGate(informantFields(COHERENT), strict)
  assert.equal(gate.passed, false)
})

test('officer resolution overrides provenance and confidence', () => {
  const fields = informantFields(COHERENT)
  const next = applyOfficerResolutions(fields, [
    { path: 'informant.monthly_repayment', action: 'EDIT', value: '3,500', by: 'o' },
  ])
  const f = next['informant.monthly_repayment']
  assert.equal(f.provenance, PROVENANCE.OFFICER)
  assert.equal(f.confidence, 1)
  assert.equal(f.value, 3500)
  assert.equal(f.superseded.value, 3000)
})

/* ------------------------------------------ deterministic obligation */

test('an undisclosed informal repayment becomes an obligation', () => {
  const out = reconcileInformantObligation(COHERENT, [], POLICY)
  assert.equal(out.applicable, true)
  assert.equal(out.corroborated, false)
  assert.equal(out.added, 3000)
})

test('a repayment already in the statement is not double-counted', () => {
  const out = reconcileInformantObligation(
    COHERENT,
    [{ label: 'Standing instruction', amount: 3000 }],
    POLICY
  )
  assert.equal(out.corroborated, true)
  assert.equal(out.added, 0)
})

test('matching uses the policy tolerance', () => {
  assert.equal(reconcileInformantObligation(COHERENT, [{ label: 'x', amount: 2700 }], POLICY).corroborated, true)
  assert.equal(reconcileInformantObligation(COHERENT, [{ label: 'x', amount: 1000 }], POLICY).corroborated, false)
})

test('a settled informal loan adds nothing', () => {
  const settled = { ...COHERENT, current_outstanding: 0, monthly_repayment: 0 }
  assert.equal(reconcileInformantObligation(settled, [], POLICY).applicable, false)
})

test('the obligation reaches FOIR and the fingerprint through the engine', () => {
  const without = computeCreditMetrics({ evidence: BASE_EVIDENCE, loanRequest: LOAN, policy: POLICY })
  const withRef = computeCreditMetrics({
    evidence: { ...BASE_EVIDENCE, informant: COHERENT },
    loanRequest: LOAN,
    policy: POLICY,
  })
  assert.equal(without.metrics.obligations, 0)
  assert.equal(withRef.metrics.obligations, 3000)
  assert.ok(withRef.metrics.foir > without.metrics.foir)
  assert.equal(withRef.metrics.emi, without.metrics.emi)
  assert.notEqual(withRef.input_hash, without.input_hash)
})

test('a reference cannot raise recognised income', () => {
  const base = computeCreditMetrics({ evidence: BASE_EVIDENCE, loanRequest: LOAN, policy: POLICY })
  const loaded = computeCreditMetrics({
    evidence: { ...BASE_EVIDENCE, informant: { ...COHERENT, principal_lent: 5000000 } },
    loanRequest: LOAN,
    policy: POLICY,
  })
  assert.equal(
    loaded.metrics.verified_monthly_income,
    base.metrics.verified_monthly_income
  )
})

test('numbers asserted alongside the evidence are ignored', () => {
  const truth = computeCreditMetrics({
    evidence: { ...BASE_EVIDENCE, informant: COHERENT },
    loanRequest: LOAN,
    policy: POLICY,
  })
  const tampered = computeCreditMetrics({
    evidence: {
      ...BASE_EVIDENCE,
      informant: { ...COHERENT, _asserted_emi: 1, _asserted_foir: 0.01 },
    },
    loanRequest: LOAN,
    policy: POLICY,
  })
  assert.equal(tampered.metrics.emi, truth.metrics.emi)
  assert.notEqual(tampered.metrics.emi, 1)
  assert.notEqual(tampered.metrics.foir, 0.01)
})

/* ----------------------------------------------------- reconciliation */

test('name similarity tolerates reordering and initials', () => {
  assert.equal(nameSimilarity('Rahul Sharma', 'SHARMA RAHUL'), 1)
  assert.ok(nameSimilarity('Rahul Sharma', 'R Sharma') > 0.7)
  assert.ok(nameSimilarity('Rahul Sharma', 'Imran Qureshi') < 0.5)
})

test('informant findings appear only when a reference exists', () => {
  const credit = computeCreditMetrics({ evidence: BASE_EVIDENCE, loanRequest: LOAN, policy: POLICY })
  const without = reconcile({ evidence: BASE_EVIDENCE, loanRequest: LOAN, creditMetrics: credit, policy: POLICY })
  assert.equal(without.findings.filter((f) => f.code.startsWith('RC-INF')).length, 0)

  const evidence = { ...BASE_EVIDENCE, applicant: { ...BASE_EVIDENCE.applicant, name: 'Rahul Sharma' }, informant: COHERENT }
  const c2 = computeCreditMetrics({ evidence, loanRequest: LOAN, policy: POLICY })
  const withRef = reconcile({ evidence, loanRequest: LOAN, creditMetrics: c2, policy: POLICY })
  const codes = withRef.findings.filter((f) => f.code.startsWith('RC-INF')).map((f) => f.code)
  assert.ok(codes.includes('RC-INF-01'))
  assert.ok(codes.includes('RC-INF-03'))
  assert.ok(codes.includes('RC-INF-05'))
})

/* ------------------------------------------------------- policy engine */

test('a rule whose metric is absent is not applicable rather than failing', () => {
  const credit = computeCreditMetrics({ evidence: BASE_EVIDENCE, loanRequest: LOAN, policy: POLICY })
  const rec = reconcile({ evidence: BASE_EVIDENCE, loanRequest: LOAN, creditMetrics: credit, policy: POLICY })
  const evaluation = evaluatePolicy({
    metrics: credit.metrics,
    reconciliation: rec,
    unresolvedLowConfidence: 0,
    loanRequest: LOAN,
    policy: POLICY,
  })
  const rule = evaluation.rules.find((r) => r.code === 'P-INF-01')
  assert.equal(rule.outcome, 'NOT_APPLICABLE')
})

test('the policy engine holds no thresholds of its own', () => {
  const credit = computeCreditMetrics({ evidence: BASE_EVIDENCE, loanRequest: LOAN, policy: POLICY })
  const rec = reconcile({ evidence: BASE_EVIDENCE, loanRequest: LOAN, creditMetrics: credit, policy: POLICY })
  const tightened = JSON.parse(JSON.stringify(POLICY))
  for (const r of tightened.rules) if (r.code === 'P-FOIR-01') r.threshold = 0.01
  const evaluation = evaluatePolicy({
    metrics: credit.metrics,
    reconciliation: rec,
    unresolvedLowConfidence: 0,
    loanRequest: LOAN,
    policy: tightened,
  })
  assert.equal(evaluation.rules.find((r) => r.code === 'P-FOIR-01').outcome, 'FAIL')
})
