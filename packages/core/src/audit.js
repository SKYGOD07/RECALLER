/**
 * RECALLER — audit trail primitives.
 *
 * Every state transition an application undergoes is appended here as an
 * immutable event. The ledger is hash-chained: each event carries the digest of
 * the one before it, so a tampered or dropped event breaks verification.
 */

import { hashValue } from './hash.js';

export const STAGES = /** @type {const} */ ([
  'APPLICATION_CREATED',
  'DOCUMENT_INGESTED',
  'KYC_EXTRACTION',
  'BANK_EXTRACTION',
  'PLATFORM_EXTRACTION',
  'INVOICE_EXTRACTION',
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
]);

export const STAGE_LABELS = {
  APPLICATION_CREATED: 'Application created',
  DOCUMENT_INGESTED: 'Documents ingested',
  KYC_EXTRACTION: 'KYC extraction',
  BANK_EXTRACTION: 'Bank statement extraction',
  PLATFORM_EXTRACTION: 'Platform earnings extraction',
  INVOICE_EXTRACTION: 'Dealer invoice extraction',
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
};

/** Who or what produced an event. Recorded so the LLM's reach is auditable. */
export const ACTORS = {
  SYSTEM: 'SYSTEM',
  ENGINE: 'ENGINE',
  LLM: 'LLM',
  OFFICER: 'OFFICER',
  N8N: 'N8N',
};

export function createLedger(traceId) {
  return { traceId, events: [], head: '0'.repeat(32) };
}

/**
 * Append an event to a ledger, returning a NEW ledger (the input is untouched).
 * @param {object} ledger
 * @param {{stage:string, actor:string, summary:string, detail?:object, durationMs?:number, at?:string}} event
 */
export function appendEvent(ledger, event) {
  const seq = ledger.events.length + 1;
  const body = {
    seq,
    stage: event.stage,
    actor: event.actor ?? ACTORS.SYSTEM,
    summary: event.summary,
    detail: event.detail ?? {},
    durationMs: event.durationMs ?? null,
    at: event.at ?? new Date().toISOString(),
    prev: ledger.head,
  };
  const digest = hashValue(body);
  const entry = { ...body, digest, traceId: ledger.traceId };
  return { traceId: ledger.traceId, events: [...ledger.events, entry], head: digest };
}

/** Recompute the chain and report the first index where it breaks, if any. */
export function verifyLedger(ledger) {
  let prev = '0'.repeat(32);
  for (let i = 0; i < ledger.events.length; i += 1) {
    const e = ledger.events[i];
    const { digest, traceId, ...body } = e;
    if (body.prev !== prev) return { ok: false, brokenAt: i, reason: 'chain-link-mismatch' };
    if (hashValue(body) !== digest) return { ok: false, brokenAt: i, reason: 'digest-mismatch' };
    prev = digest;
  }
  return { ok: true, brokenAt: null, reason: null };
}
