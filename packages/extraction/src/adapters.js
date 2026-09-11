/**
 * RECALLER — extraction layer adapters and confidence gating.
 *
 * JavaScript port of recaller/extraction/adapters.py.
 */

import { DOC_TYPES, PROVENANCE } from '@core/constants.js'
import { hashValue, rng } from '@core/hash.js'
import { EVIDENCE_SPEC, SPEC_BY_PATH, field, getPath, toValues } from './schema.js'

function citationSnippet(spec, value) {
  if (Array.isArray(value)) return `${spec.label}: ${value.length} monthly values`
  if (spec.type === 'money') {
    try {
      return `${spec.label}: ₹${Math.round(Number(value)).toLocaleString('en-IN')}`
    } catch {
      return `${spec.label}: ₹${value}`
    }
  }
  return `${spec.label}: ${String(value).slice(0, 64)}`
}

function baseConfidence(spec, value, nextPrng) {
  let c = 0.975
  if (spec.type === 'text' && String(value || '').length > 40) c -= 0.05
  if (spec.type === 'id') c -= 0.01
  if (spec.type === 'list') c -= 0.008
  if (spec.doc === DOC_TYPES.BANK_STATEMENT) c -= 0.015
  if (spec.doc === DOC_TYPES.PLATFORM_EARNINGS) c -= 0.008
  c -= nextPrng() * 0.05
  return Math.max(0.35, Math.min(0.999, c))
}

const fixtureAdapter = {
  name: 'fixture',

  extract(document, seed) {
    const docId = document.id || ''
    const nextPrng = rng(`${seed}:${docId}`)
    const payload = document.payload || {}
    const degrade = document.degrade || {}
    const pageMap = document.pageMap || {}
    const out = {}

    const docType = document.type
    for (const spec of EVIDENCE_SPEC) {
      if (spec.doc === docType) {
        const p = spec.path
        const val = getPath(payload, p)
        if (val == null) continue
        const forced = degrade[p]
        const conf = forced != null ? forced : baseConfidence(spec, val, nextPrng)
        out[p] = field(p, val, {
          confidence: conf,
          citation: {
            document: document.filename || '',
            document_id: docId,
            page: pageMap[p] || 1,
            snippet: citationSnippet(spec, val),
          },
          raw: typeof val === 'string' ? val : null,
        })
      }
    }
    return out
  },
}

function ageFrom(dobIso, asOfIso) {
  try {
    const dob = new Date(dobIso)
    const asOf = asOfIso ? new Date(asOfIso) : new Date()
    let age = asOf.getFullYear() - dob.getFullYear()
    if (
      asOf.getMonth() < dob.getMonth() ||
      (asOf.getMonth() === dob.getMonth() && asOf.getDate() < dob.getDate())
    ) {
      age -= 1
    }
    return age
  } catch {
    return 30
  }
}

/**
 * Run the extraction stage across a document bundle.
 */
export async function extractBundle({ documents, application, adapter = fixtureAdapter, seed = null }) {
  const actualSeed = seed || application.id || 'RECALLER'
  const fields = {}
  const byDocument = {}

  for (const doc of documents) {
    let produced
    if (typeof adapter.extract === 'function') {
      produced = adapter.extract(doc, actualSeed)
    } else {
      produced = adapter(doc, actualSeed)
    }
    if (produced instanceof Promise) produced = await produced
    byDocument[doc.id] = Object.keys(produced)
    Object.assign(fields, produced)
  }

  // Stated income
  if (application.declared_monthly_income != null) {
    fields['applicant.declared_monthly_income'] = field('applicant.declared_monthly_income', application.declared_monthly_income, {
      confidence: 1.0,
      provenance: PROVENANCE.DECLARED,
      citation: { document: 'Application form', page: 1, snippet: 'Stated by applicant' },
    })
  }

  // Derived age
  const dob = fields['applicant.dob']
  if (dob && dob.value) {
    const ageVal = ageFrom(dob.value, application.created_at)
    fields['applicant.age'] = field('applicant.age', ageVal, {
      confidence: dob.confidence || 1.0,
      provenance: PROVENANCE.COMPUTED,
      citation: {
        ...(dob.citation || {}),
        snippet: `Derived from date of birth ${dob.value}`,
      },
    })
  }

  const fieldList = Object.values(fields)
  const confs = fieldList.map((f) => f.confidence || 1.0)

  const stats = {
    total: fieldList.length,
    mean_confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
    min_confidence: confs.length ? Math.min(...confs) : 0,
    adapter: adapter.name || 'custom',
  }

  const hashPayload = Object.fromEntries(fieldList.map((f) => [f.path, [f.value, f.confidence]]))

  return {
    fields,
    byDocument,
    stats,
    extraction_hash: hashValue(hashPayload),
  }
}

/**
 * Hold back fields below confidence floor for human review.
 */
export function applyConfidenceGate(fields, policy) {
  const confPolicy = policy.confidence || {}
  const fieldThreshold = confPolicy.field_threshold ?? 0.8
  const criticalFieldThreshold = confPolicy.critical_field_threshold ?? 0.88
  const criticalFields = confPolicy.critical_fields || []

  const held = []
  for (const f of Object.values(fields)) {
    if (f.provenance === PROVENANCE.OFFICER) continue
    const p = f.path
    const isCritical = criticalFields.includes(p) || f.critical
    const floor = isCritical ? criticalFieldThreshold : fieldThreshold
    const conf = f.confidence ?? 1.0
    if (conf < floor) {
      held.push({
        path: p,
        label: f.label,
        value: f.value,
        type: f.type,
        confidence: conf,
        floor,
        critical: isCritical,
        citation: f.citation,
        reason: isCritical
          ? 'Critical field extracted below the strict confidence floor'
          : 'Extracted below the confidence floor',
        status: 'PENDING',
      })
    }
  }

  held.sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1
    return a.confidence - b.confidence
  })

  return {
    passed: held.length === 0,
    held,
    thresholds: { field_threshold: fieldThreshold, critical_field_threshold: criticalFieldThreshold },
  }
}

function coerce(value, valType) {
  if (valType === 'money' || valType === 'number') {
    try {
      const cleaned = String(value).replace(/[,\s₹]/g, '')
      return cleaned.includes('.') ? parseFloat(cleaned) : parseInt(cleaned, 10)
    } catch {
      return null
    }
  }
  if (valType === 'list') return coerceList(value)
  return value
}

function coerceList(value) {
  if (Array.isArray(value)) return value
  const text = String(value || '')
  if (/[A-Za-z]/.test(text)) {
    const items = []
    for (const part of text.split(/[;\n]/)) {
      const m = part.trim().match(/(\d[\d,]*(?:\.\d+)?)\s*$/)
      if (!m) continue
      const label = part.trim().slice(0, m.index).replace(/^[\s\-:,]+|[\s\-:,]+$/g, '') || 'Officer-entered obligation'
      items.push({ label, amount: parseFloat(m[1].replace(/,/g, '')), kind: 'LOAN_EMI', source: 'Officer entry' })
    }
    return items
  }
  const nums = text.match(/\d[\d,]*(?:\.\d+)?/g) || []
  return nums.map((n) => {
    const cleaned = n.replace(/,/g, '')
    return cleaned.includes('.') ? parseFloat(cleaned) : parseInt(cleaned, 10)
  })
}

/**
 * Fold officer resolutions (CONFIRM, EDIT, REJECT) into evidence fields.
 */
export function applyOfficerResolutions(fields, resolutions) {
  if (!resolutions || resolutions.length === 0) {
    return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { ...v }]))
  }

  const nextFields = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { ...v }]))
  for (const r of resolutions) {
    const path = r.path
    const orig = nextFields[path]
    if (!orig) continue
    const nowIso = r.at || new Date().toISOString()
    const base = {
      ...orig,
      provenance: PROVENANCE.OFFICER,
      confidence: 1.0,
      superseded: {
        value: orig.value,
        confidence: orig.confidence,
        provenance: orig.provenance,
      },
      officer: {
        action: r.action,
        by: r.by || 'officer',
        at: nowIso,
        note: r.note,
      },
    }
    if (r.action === 'CONFIRM') {
      nextFields[path] = base
    } else if (r.action === 'EDIT') {
      nextFields[path] = { ...base, value: coerce(r.value, orig.type || 'text') }
    } else if (r.action === 'REJECT') {
      nextFields[path] = { ...base, value: null, confidence: 0.0 }
    }
  }
  return nextFields
}

/**
 * Collapse field map to values.
 */
export function materialise(fields) {
  return toValues(fields)
}

export { fixtureAdapter }
