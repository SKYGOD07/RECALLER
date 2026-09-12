/**
 * RECALLER — informal-lender reference: attestation quality and ledger coherence.
 *
 * JavaScript port of recaller/extraction/informant.py.
 *
 * A thin-file borrower is rarely a no-credit borrower. They have usually been
 * lent to for years — by a shopkeeper, a chit fund, a private moneylender — and
 * repaid. Nobody wrote it down. An *informant* is that counterparty, stating on
 * the record what they lent and how they were repaid.
 *
 * That statement is evidence, and it is treated as evidence: typed, scored and
 * sourced like anything read off a bank statement. What it is not is a
 * verification. Nothing here can raise a policy ceiling or manufacture income.
 * What it can do is add an obligation the bank statement never revealed, and
 * supply a repayment record no bureau holds.
 *
 * Confidence on these fields is computed, never sampled, from four measurable
 * signals: completeness, whether an officer reached the informant, how long the
 * relationship has run, and whether the informant's own numbers agree with each
 * other. The last is the sharpest — principal lent, amount outstanding, monthly
 * repayment and months known are four numbers describing one loan, and they
 * imply each other.
 */

import { INFORMANT_ARMS_LENGTH, PROVENANCE } from '@core/constants.js'
import { roundHalfUp, toPaise, toRupees } from '@core/money.js'

/** Fields that describe who the informant is. */
export const IDENTITY_PATHS = [
  'informant.name',
  'informant.relationship',
  'informant.business_name',
  'informant.contact',
  'informant.contact_verified',
  'informant.borrower_known_as',
  'informant.attested_at',
  'informant.note',
]

/**
 * The four numbers that describe one loan and therefore imply each other. A
 * contradiction between them discredits all four.
 */
export const ARITHMETIC_PATHS = [
  'informant.months_known',
  'informant.principal_lent',
  'informant.current_outstanding',
  'informant.monthly_repayment',
]

/**
 * How the borrower behaved. Separate on purpose: a reference that fumbles the
 * arithmetic of a loan has not thereby become unreliable about whether the
 * borrower paid on time, and sweeping these into the same score buried an
 * officer in queue items they had no way to act on.
 */
export const CONDUCT_PATHS = [
  'informant.missed_payments_12m',
  'informant.longest_delay_days',
  'informant.would_lend_again',
]

export const LEDGER_PATHS = [...ARITHMETIC_PATHS, ...CONDUCT_PATHS]

/**
 * What a complete reference looks like. Completeness is measured against this,
 * not against everything the schema permits — a note is nice, not material.
 */
export const EXPECTED_PATHS = [
  'informant.name',
  'informant.relationship',
  'informant.contact',
  'informant.months_known',
  'informant.principal_lent',
  'informant.current_outstanding',
  'informant.monthly_repayment',
  'informant.missed_payments_12m',
  'informant.attested_at',
]

export const DEFAULTS = Object.freeze({
  source_confidence_ceiling: 0.74,
  unverified_contact_ceiling: 0.62,
  non_arms_length_ceiling: 0.55,
  min_months_known: 6,
  ledger_tolerance_months: 1.5,
})

function settings(policy) {
  return { ...DEFAULTS, ...((policy?.confidence || {}).informant || {}) }
}

function num(value) {
  if (value == null || typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function money(value) {
  const n = num(value)
  return n == null ? null : toRupees(toPaise(n))
}

function truthy(value) {
  if (typeof value === 'boolean') return value
  return ['TRUE', 'YES', 'Y', '1', 'VERIFIED'].includes(String(value).trim().toUpperCase())
}

function inr(amount) {
  return `₹${Math.round(Number(amount)).toLocaleString('en-IN')}`
}

/** Share of the expected reference fields that were actually supplied. */
export function completeness(informant) {
  let present = 0
  for (const path of EXPECTED_PATHS) {
    const key = path.slice(path.indexOf('.') + 1)
    const value = (informant || {})[key]
    if (value == null) continue
    if (typeof value === 'string' && !value.trim()) continue
    present += 1
  }
  return roundHalfUp(present / EXPECTED_PATHS.length, 4)
}

/**
 * Do the informant's four numbers describe the same loan?
 *
 * A reference saying "I lent 45,000, he still owes 12,000, he pays me 3,000 a
 * month, I have known him 34 months" is coherent: 33,000 repaid at 3,000 a
 * month is 11 months of repayment, comfortably inside 34. One saying he has
 * repaid 90,000 of a 45,000 loan is not, and no parser confidence rescues it.
 */
export function ledgerCoherence(informant, policy = null) {
  const cfg = settings(policy || {})
  const problems = []

  const principal = money(informant?.principal_lent)
  const outstanding = money(informant?.current_outstanding)
  const monthly = money(informant?.monthly_repayment)
  const monthsKnown = num(informant?.months_known)
  const missed = num(informant?.missed_payments_12m)

  // Not enough numbers to check anything. Unknown is not the same as wrong, so
  // this scores as a partial rather than a failure.
  if (principal == null || outstanding == null) {
    return {
      score: 0.7,
      arithmetic_score: 0.7,
      conduct_score: 0.7,
      checkable: false,
      problems: [],
      implied_months_repaid: null,
      implied_months_remaining: null,
    }
  }

  let score = 1.0

  if (outstanding > principal) {
    problems.push({
      code: 'OUTSTANDING_EXCEEDS_PRINCIPAL',
      scope: 'ARITHMETIC',
      detail: `Outstanding ${inr(outstanding)} exceeds principal lent ${inr(principal)}.`,
      weight: 0.45,
    })
    score -= 0.45
  }

  const repaid = Math.max(0, principal - outstanding)
  let impliedMonthsRepaid = null
  let impliedMonthsRemaining = null

  if (monthly != null && monthly > 0) {
    impliedMonthsRepaid = roundHalfUp(repaid / monthly, 2)
    if (outstanding > 0) impliedMonthsRemaining = roundHalfUp(outstanding / monthly, 2)

    if (monthsKnown != null) {
      const allowance = monthsKnown + Number(cfg.ledger_tolerance_months)
      if (impliedMonthsRepaid > allowance) {
        const overshoot = impliedMonthsRepaid - allowance
        // Scaled, not binary: two months over is a rounding argument, two years
        // over is a different loan.
        const penalty = Math.min(0.45, 0.08 + overshoot * 0.03)
        problems.push({
          code: 'REPAYMENT_EXCEEDS_RELATIONSHIP',
          scope: 'ARITHMETIC',
          detail:
            `${inr(repaid)} repaid at ${inr(monthly)}/month implies ${impliedMonthsRepaid} ` +
            `months of repayment, but the relationship is stated as ${monthsKnown} months.`,
          weight: roundHalfUp(penalty, 4),
        })
        score -= penalty
      }
    }
  } else if (outstanding > 0) {
    problems.push({
      code: 'OUTSTANDING_WITHOUT_REPAYMENT',
      scope: 'ARITHMETIC',
      detail: `${inr(outstanding)} outstanding but no monthly repayment stated.`,
      weight: 0.2,
    })
    score -= 0.2
  }

  if (missed != null && monthsKnown != null) {
    const observable = Math.min(12, monthsKnown)
    if (missed > observable) {
      problems.push({
        code: 'MISSED_EXCEEDS_OBSERVABLE',
        scope: 'CONDUCT',
        detail:
          `${missed} missed payments reported over a relationship of only ` +
          `${monthsKnown} months.`,
        weight: 0.2,
      })
      score -= 0.2
    }
  }

  const sumWeights = (scope) =>
    problems.filter((p) => p.scope === scope).reduce((a, p) => a + p.weight, 0)

  return {
    score: roundHalfUp(Math.max(0, Math.min(1, score)), 4),
    arithmetic_score: roundHalfUp(Math.max(0, Math.min(1, 1 - sumWeights('ARITHMETIC'))), 4),
    conduct_score: roundHalfUp(Math.max(0, Math.min(1, 1 - sumWeights('CONDUCT'))), 4),
    checkable: true,
    problems,
    implied_months_repaid: impliedMonthsRepaid,
    implied_months_remaining: impliedMonthsRemaining,
  }
}

/** The full deterministic confidence picture for one informant reference. */
export function attestationQuality(informant, policy = null) {
  const cfg = settings(policy || {})

  const comp = completeness(informant)
  const coherence = ledgerCoherence(informant, policy)
  const verified = truthy(informant?.contact_verified)
  const relationship = String(informant?.relationship || '').trim().toUpperCase()
  const armsLength = INFORMANT_ARMS_LENGTH.includes(relationship)

  const monthsKnown = num(informant?.months_known) || 0
  const minMonths = Number(cfg.min_months_known)
  // Saturates at twice the policy minimum; a ten-year relationship is not twice
  // as attestable as a five-year one.
  const depth =
    minMonths > 0 ? roundHalfUp(Math.max(0, Math.min(1, monthsKnown / (minMonths * 2))), 4) : 1.0

  let ceiling = Number(cfg.source_confidence_ceiling)
  if (!verified) ceiling = Math.min(ceiling, Number(cfg.unverified_contact_ceiling))
  if (!armsLength) ceiling = Math.min(ceiling, Number(cfg.non_arms_length_ceiling))

  // Two quality scores in 0..1, then scaled by the ceiling rather than clamped
  // to it. Clamping flattened every difference above the cap, so a reference
  // with a mild contradiction scored exactly like a flawless one and the number
  // stopped carrying information. Scaling keeps the cap absolute while leaving
  // every signal visible.
  const identityScore = 0.55 + 0.3 * comp + 0.15 * (verified ? 1 : 0)
  const substance = 0.5 + 0.25 * comp + 0.25 * depth
  const ledgerScore = substance * coherence.arithmetic_score
  const conductScore = substance * coherence.conduct_score

  const identity = ceiling * Math.min(1, identityScore)
  const ledger = ceiling * Math.min(1, ledgerScore)
  const conduct = ceiling * Math.min(1, conductScore)

  return {
    identity_score: roundHalfUp(Math.min(1, identityScore), 4),
    ledger_score: roundHalfUp(Math.min(1, ledgerScore), 4),
    conduct_score: roundHalfUp(Math.min(1, conductScore), 4),
    completeness: comp,
    coherence,
    contact_verified: verified,
    arms_length: armsLength,
    relationship: relationship || null,
    months_known: monthsKnown,
    depth,
    ceiling: roundHalfUp(ceiling, 4),
    identity_confidence: roundHalfUp(Math.max(0.05, Math.min(ceiling, identity)), 4),
    ledger_confidence: roundHalfUp(Math.max(0.05, Math.min(ceiling, ledger)), 4),
    conduct_confidence: roundHalfUp(Math.max(0.05, Math.min(ceiling, conduct)), 4),
  }
}

/** Confidence for one informant field, from the reference's overall quality. */
export function confidenceFor(path, informant, policy = null, quality = null) {
  const q = quality || attestationQuality(informant, policy)
  if (ARITHMETIC_PATHS.includes(path)) return q.ledger_confidence
  if (CONDUCT_PATHS.includes(path)) return q.conduct_confidence
  return q.identity_confidence
}

/** True for evidence a third party asserted rather than a document showed. */
export function isAttested(fieldOrSpec) {
  if (fieldOrSpec?.provenance === PROVENANCE.INFORMANT) return true
  return Boolean(fieldOrSpec?.attested)
}
