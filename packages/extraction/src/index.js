/**
 * RECALLER — extraction layer.
 *
 * Turns a document bundle into confidence-scored evidence fields. Two adapters
 * are supported behind one interface:
 *
 *   - `fixtureAdapter`  reads the structured payload attached to a synthetic
 *                       document and replays deterministic confidence jitter.
 *                       This is what the demo environment runs on.
 *   - `llmAdapter`      calls a document-understanding model (optional at
 *                       install time; see app-backend/src/llm).
 *
 * Either way, the output shape is identical and the confidence gate downstream
 * is the same. The adapter reads documents; it never computes money.
 */

import { field, EVIDENCE_SPEC, SPEC_BY_PATH, toValues, getPath } from './schema.js';
import { rng, hashValue } from '../../core/src/hash.js';
import { PROVENANCE, DOC_TYPES } from '../../core/src/constants.js';

export * from './schema.js';

/** Which document type each evidence group is read from. */
const GROUP_DOC = {
  applicant: DOC_TYPES.AADHAAR,
  bank: DOC_TYPES.BANK_STATEMENT,
  platform: DOC_TYPES.PLATFORM_EARNINGS,
  invoice: DOC_TYPES.DEALER_INVOICE,
};

/**
 * Deterministic confidence model.
 *
 * Real OCR confidence is a function of the field's visual character: printed
 * machine text scores high, handwritten or stamped regions score low, long
 * free-text scores lower than a short numeric token. We model that shape so the
 * demo's low-confidence cases are plausible rather than arbitrary — and we
 * drive it from a seeded PRNG so the same bundle always gates the same fields.
 */
function baseConfidence(spec, value, next) {
  let c = 0.975;
  if (spec.type === 'text' && String(value ?? '').length > 40) c -= 0.05; // addresses
  if (spec.type === 'id') c -= 0.01;
  if (spec.type === 'list') c -= 0.008;
  if (spec.doc === DOC_TYPES.BANK_STATEMENT) c -= 0.015; // scanned, often re-printed
  if (spec.doc === DOC_TYPES.PLATFORM_EARNINGS) c -= 0.008;
  c -= next() * 0.05;
  return Math.max(0.35, Math.min(0.999, c));
}

/**
 * The fixture adapter. A synthetic document carries `payload` (ground truth)
 * and optionally `degrade` — a map of field path to a forced confidence, which
 * is how the demo data stages its low-confidence and mismatch scenarios.
 */
export const fixtureAdapter = {
  name: 'fixture',
  async extract(document, { seed }) {
    const next = rng(`${seed}:${document.id}`);
    const payload = document.payload ?? {};
    const degrade = document.degrade ?? {};
    const out = {};

    EVIDENCE_SPEC.filter((s) => s.doc === document.type).forEach((spec) => {
      const value = getPath(payload, spec.path);
      if (value === undefined) return;
      const forced = degrade[spec.path];
      const confidence = forced !== undefined ? forced : baseConfidence(spec, value, next);
      out[spec.path] = field(spec.path, value, {
        confidence,
        citation: {
          document: document.filename,
          document_id: document.id,
          page: document.pageMap?.[spec.path] ?? 1,
          snippet: citationSnippet(spec, value),
        },
        raw: typeof value === 'string' ? value : null,
      });
    });

    return out;
  },
};

function citationSnippet(spec, value) {
  if (Array.isArray(value)) return `${spec.label}: ${value.length} monthly values`;
  if (spec.type === 'money') return `${spec.label}: ₹${Number(value).toLocaleString('en-IN')}`;
  return `${spec.label}: ${String(value).slice(0, 64)}`;
}

/**
 * Run the extraction stage across a bundle.
 *
 * @param {object} args
 * @param {Array}  args.documents   uploaded/synthetic documents
 * @param {object} args.application application header (for declared values)
 * @param {object} [args.adapter]   defaults to fixtureAdapter
 * @param {string} args.seed        deterministic seed, usually the application id
 * @returns {Promise<{fields:object, byDocument:object, stats:object, extraction_hash:string}>}
 */
export async function extractBundle({ documents, application, adapter = fixtureAdapter, seed }) {
  const fields = {};
  const byDocument = {};

  for (const doc of documents) {
    const produced = await adapter.extract(doc, { seed });
    byDocument[doc.id] = Object.keys(produced);
    Object.assign(fields, produced);
  }

  // Values the applicant states rather than evidences. Marked DECLARED so no
  // part of the system mistakes them for verified.
  if (application?.declared_monthly_income != null) {
    fields['applicant.declared_monthly_income'] = field(
      'applicant.declared_monthly_income',
      application.declared_monthly_income,
      { confidence: 1, provenance: PROVENANCE.DECLARED, citation: { document: 'Application form', page: 1, snippet: 'Stated by applicant' } },
    );
  }

  // Age is derived from the extracted DOB, not read separately; it inherits the
  // DOB's confidence because it can be no more certain than its source.
  const dob = fields['applicant.dob'];
  if (dob?.value) {
    const age = ageFrom(dob.value, application?.created_at);
    fields['applicant.age'] = field('applicant.age', age, {
      confidence: dob.confidence,
      provenance: PROVENANCE.COMPUTED,
      citation: { ...dob.citation, snippet: `Derived from date of birth ${dob.value}` },
    });
  }

  const list = Object.values(fields);
  return {
    fields,
    byDocument,
    stats: {
      total: list.length,
      mean_confidence: list.length ? list.reduce((a, f) => a + f.confidence, 0) / list.length : 0,
      min_confidence: list.length ? Math.min(...list.map((f) => f.confidence)) : 0,
      adapter: adapter.name,
    },
    extraction_hash: hashValue(Object.fromEntries(list.map((f) => [f.path, [f.value, f.confidence]]))),
  };
}

function ageFrom(dobIso, asOfIso) {
  const dob = new Date(dobIso);
  const asOf = asOfIso ? new Date(asOfIso) : new Date();
  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const m = asOf.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/**
 * The confidence gate.
 *
 * Any field below its threshold is held back for a human. Critical fields carry
 * a stricter floor. The system does NOT guess, does not fall back to a second
 * model, and does not proceed — it parks the execution and asks.
 *
 * @returns {{ passed: boolean, held: Array, thresholds: object }}
 */
export function applyConfidenceGate(fields, policy) {
  const { field_threshold, critical_field_threshold, critical_fields } = policy.confidence;
  const held = [];

  Object.values(fields).forEach((f) => {
    if (f.provenance === PROVENANCE.OFFICER) return; // already human-confirmed
    const isCritical = critical_fields.includes(f.path) || f.critical;
    const floor = isCritical ? critical_field_threshold : field_threshold;
    if (f.confidence < floor) {
      held.push({
        path: f.path,
        label: f.label,
        value: f.value,
        type: f.type,
        confidence: f.confidence,
        floor,
        critical: isCritical,
        citation: f.citation,
        reason: isCritical
          ? 'Critical field extracted below the strict confidence floor'
          : 'Extracted below the confidence floor',
        status: 'PENDING',
      });
    }
  });

  held.sort((a, b) => Number(b.critical) - Number(a.critical) || a.confidence - b.confidence);
  return {
    passed: held.length === 0,
    held,
    thresholds: { field_threshold, critical_field_threshold },
  };
}

/**
 * Fold officer decisions back into the evidence set.
 *
 * CONFIRM  — keep the extracted value, stamp it OFFICER at full confidence
 * EDIT     — replace with the officer's value, stamp OFFICER
 * REJECT   — drop the value; downstream metrics that need it become unavailable
 *
 * The original extracted value is preserved on the field as `superseded` so the
 * audit trail and memo can show exactly what the human changed.
 */
export function applyOfficerResolutions(fields, resolutions = []) {
  const next = { ...fields };
  resolutions.forEach((r) => {
    const original = next[r.path];
    if (!original) return;
    const base = {
      ...original,
      provenance: PROVENANCE.OFFICER,
      confidence: 1,
      superseded: {
        value: original.value,
        confidence: original.confidence,
        provenance: original.provenance,
      },
      officer: { action: r.action, by: r.by ?? 'officer', at: r.at ?? new Date().toISOString(), note: r.note ?? null },
    };
    if (r.action === 'CONFIRM') next[r.path] = base;
    else if (r.action === 'EDIT') next[r.path] = { ...base, value: coerce(r.value, original.type) };
    else if (r.action === 'REJECT') next[r.path] = { ...base, value: null, confidence: 0 };
  });
  return next;
}

function coerce(value, type) {
  if (type === 'money' || type === 'number') {
    const n = Number(String(value).replace(/[,\s₹]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

/** Convenience: gated field map → plain values for the deterministic engines. */
export function materialise(fields) {
  return toValues(fields);
}

export { SPEC_BY_PATH };
