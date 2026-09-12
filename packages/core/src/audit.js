/**
 * RECALLER — audit trail primitives.
 *
 * JavaScript port of recaller/core/audit.py.
 * Every state transition is appended as an immutable event. The ledger is
 * hash-chained: each event carries the digest of the one before it, so a
 * tampered or dropped event breaks verification.
 */

import { hashValue } from './hash.js'

export const STAGES = [
  'APPLICATION_CREATED',
  'DOCUMENT_INGESTED',
  'KYC_EXTRACTION',
  'BANK_EXTRACTION',
  'PLATFORM_EXTRACTION',
  'INVOICE_EXTRACTION',
  'INFORMANT_ATTESTATION',
  'EVIDENCE_VALIDATION',
  'RECONCILIATION',
  'CONFIDENCE_GATE',
  'OFFICER_REVIEW',
  'CREDIT_CALCULATION',
  'POLICY_EVALUATION',
  'DECISION',
  'NARRATION',
  'MEMO_GENERATED',
  'REPLAY',
  'WHAT_IF',
]

export const STAGE_LABELS = {
  APPLICATION_CREATED: 'Application created',
  DOCUMENT_INGESTED: 'Documents ingested',
  KYC_EXTRACTION: 'KYC extraction',
  BANK_EXTRACTION: 'Bank statement extraction',
  PLATFORM_EXTRACTION: 'Platform earnings extraction',
  INVOICE_EXTRACTION: 'Dealer invoice extraction',
  INFORMANT_ATTESTATION: 'Informal-lender reference',
  EVIDENCE_VALIDATION: 'Evidence validation',
  RECONCILIATION: 'Cross-document reconciliation',
  CONFIDENCE_GATE: 'Confidence gate',
  OFFICER_REVIEW: 'Officer review',
  CREDIT_CALCULATION: 'Deterministic credit calculation',
  POLICY_EVALUATION: 'Policy evaluation',
  DECISION: 'Decision',
  NARRATION: 'Narration',
  MEMO_GENERATED: 'Credit memo generated',
  REPLAY: 'Replay',
  WHAT_IF: 'What-if simulation',
}

export const ACTORS = Object.freeze({
  SYSTEM: 'SYSTEM',
  ENGINE: 'ENGINE',
  LLM: 'LLM',
  OFFICER: 'OFFICER',
  N8N: 'N8N',
})

/**
 * Create a new empty audit ledger.
 */
export function createLedger(traceId) {
  return { traceId, events: [], head: '0'.repeat(32) }
}

/**
 * Append an event to a ledger, returning a new ledger dictionary.
 */
export function appendEvent(ledger, event) {
  const seq = (ledger.events?.length ?? 0) + 1
  const nowIso = event.at || new Date().toISOString().replace('+00:00', 'Z')

  const body = {
    seq,
    stage: event.stage,
    actor: event.actor || ACTORS.SYSTEM,
    summary: event.summary || '',
    detail: event.detail != null ? event.detail : {},
    durationMs: event.durationMs,
    at: nowIso,
    prev: ledger.head || '0'.repeat(32),
  }

  const digest = hashValue(body)
  const entry = { ...body, digest, traceId: ledger.traceId }

  return {
    traceId: ledger.traceId,
    events: [...(ledger.events || []), entry],
    head: digest,
  }
}

/**
 * Recompute the chain and report the first index where it breaks, if any.
 */
export function verifyLedger(ledger) {
  let prev = '0'.repeat(32)
  const events = ledger.events || []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const body = {
      seq: e.seq,
      stage: e.stage,
      actor: e.actor,
      summary: e.summary,
      detail: e.detail || {},
      durationMs: e.durationMs,
      at: e.at,
      prev: e.prev,
    }
    if (body.prev !== prev) {
      return { ok: false, brokenAt: i, reason: 'chain-link-mismatch' }
    }
    if (hashValue(body) !== e.digest) {
      return { ok: false, brokenAt: i, reason: 'digest-mismatch' }
    }
    prev = e.digest
  }
  return { ok: true, brokenAt: null, reason: null }
}
