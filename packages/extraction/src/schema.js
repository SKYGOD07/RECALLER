/**
 * RECALLER — evidence schema.
 *
 * JavaScript port of recaller/extraction/schema.py.
 */

import { DOC_TYPES, PROVENANCE } from '@core/constants.js'

export const EVIDENCE_SPEC = [
  { path: 'applicant.name', label: 'Applicant name', type: 'text', doc: DOC_TYPES.AADHAAR, critical: true },
  { path: 'applicant.dob', label: 'Date of birth', type: 'date', doc: DOC_TYPES.AADHAAR, critical: false },
  { path: 'applicant.age', label: 'Age', type: 'number', doc: DOC_TYPES.AADHAAR, critical: false, derived: true },
  { path: 'applicant.gender', label: 'Gender', type: 'text', doc: DOC_TYPES.AADHAAR, critical: false },
  { path: 'applicant.id_number', label: 'Aadhaar number (masked)', type: 'id', doc: DOC_TYPES.AADHAAR, critical: true },
  { path: 'applicant.address', label: 'KYC address', type: 'text', doc: DOC_TYPES.AADHAAR, critical: false },
  { path: 'applicant.pan', label: 'PAN', type: 'id', doc: DOC_TYPES.PAN, critical: false },
  { path: 'applicant.pan_name', label: 'Name on PAN', type: 'text', doc: DOC_TYPES.PAN, critical: false },
  { path: 'applicant.mobile', label: 'Mobile number', type: 'text', doc: DOC_TYPES.AADHAAR, critical: false },
  { path: 'applicant.declared_monthly_income', label: 'Declared monthly income', type: 'money', doc: null, critical: false, declared: true },

  { path: 'bank.account_holder_name', label: 'Bank account holder name', type: 'text', doc: DOC_TYPES.BANK_STATEMENT, critical: true },
  { path: 'bank.account_number', label: 'Account number (masked)', type: 'id', doc: DOC_TYPES.BANK_STATEMENT, critical: true },
  { path: 'bank.bank_name', label: 'Bank', type: 'text', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.ifsc', label: 'IFSC', type: 'id', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.address', label: 'Address on statement', type: 'text', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.period', label: 'Statement period', type: 'text', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.monthly_credits', label: 'Monthly qualifying credits', type: 'list', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.monthly_cash_deposits', label: 'Monthly cash deposits', type: 'list', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.average_monthly_balance', label: 'Average monthly balance', type: 'money', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.bounce_count', label: 'Returned debits', type: 'number', doc: DOC_TYPES.BANK_STATEMENT, critical: false },
  { path: 'bank.recurring_debits', label: 'Recurring obligations detected', type: 'list', doc: DOC_TYPES.BANK_STATEMENT, critical: false },

  { path: 'platform.provider', label: 'Earnings platform', type: 'text', doc: DOC_TYPES.PLATFORM_EARNINGS, critical: false },
  { path: 'platform.partner_id', label: 'Partner / driver ID', type: 'id', doc: DOC_TYPES.PLATFORM_EARNINGS, critical: false },
  { path: 'platform.monthly_net', label: 'Monthly net settlements', type: 'list', doc: DOC_TYPES.PLATFORM_EARNINGS, critical: false },
  { path: 'platform.active_months', label: 'Active months on platform', type: 'number', doc: DOC_TYPES.PLATFORM_EARNINGS, critical: false },
  { path: 'platform.rating', label: 'Partner rating', type: 'number', doc: DOC_TYPES.PLATFORM_EARNINGS, critical: false },

  { path: 'invoice.dealer_name', label: 'Dealer', type: 'text', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.invoice_number', label: 'Invoice number', type: 'id', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.model', label: 'Vehicle model', type: 'text', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.vehicle_category', label: 'Vehicle category', type: 'text', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.chassis_number', label: 'Chassis number', type: 'id', doc: DOC_TYPES.DEALER_INVOICE, critical: true },
  { path: 'invoice.ex_showroom', label: 'Ex-showroom price', type: 'money', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.insurance', label: 'Insurance', type: 'money', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.registration', label: 'Registration & RTO', type: 'money', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.accessories', label: 'Accessories', type: 'money', doc: DOC_TYPES.DEALER_INVOICE, critical: false },
  { path: 'invoice.on_road_price', label: 'On-road price', type: 'money', doc: DOC_TYPES.DEALER_INVOICE, critical: true },
  { path: 'invoice.subsidy', label: 'FAME / state subsidy applied', type: 'money', doc: DOC_TYPES.DEALER_INVOICE, critical: false },

  // Informal-lender reference. A named third party who has actually lent to
  // this borrower states what they lent and how they were repaid. It is an
  // attestation, never a verification: it can add an obligation the bank
  // statement never showed, and it can corroborate a repayment record no
  // bureau holds, but it can never on its own loosen a policy limit.
  { path: 'informant.name', label: 'Informant name', type: 'text', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.relationship', label: 'Lending relationship', type: 'text', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.business_name', label: 'Informant business', type: 'text', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.contact', label: 'Informant contact (masked)', type: 'text', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.contact_verified', label: 'Contact verified by officer', type: 'flag', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.borrower_known_as', label: 'Borrower known to informant as', type: 'text', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.months_known', label: 'Months of lending relationship', type: 'number', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.principal_lent', label: 'Total principal lent', type: 'money', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.current_outstanding', label: 'Currently outstanding', type: 'money', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: true, attested: true },
  { path: 'informant.monthly_repayment', label: 'Monthly repayment to informant', type: 'money', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: true, attested: true },
  { path: 'informant.missed_payments_12m', label: 'Missed payments (last 12 months)', type: 'number', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.longest_delay_days', label: 'Longest delay (days)', type: 'number', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.would_lend_again', label: 'Would lend again', type: 'flag', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.attested_at', label: 'Attested on', type: 'date', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
  { path: 'informant.note', label: 'Informant note', type: 'text', doc: DOC_TYPES.INFORMANT_REFERENCE, critical: false, attested: true },
]

export const SPEC_BY_PATH = Object.fromEntries(EVIDENCE_SPEC.map((s) => [s.path, s]))

/**
 * Build a well-formed EvidenceField dictionary.
 */
export function field(path, value, { confidence = 1.0, citation = null, provenance = PROVENANCE.EXTRACTED, raw = null } = {}) {
  const spec = SPEC_BY_PATH[path] || {}
  return {
    path,
    label: spec.label || path,
    type: spec.type || 'text',
    critical: spec.critical || false,
    value,
    confidence: Math.max(0, Math.min(1, Number(confidence))),
    provenance,
    citation,
    raw,
  }
}

/**
 * Read a dotted path out of a nested object.
 */
export function getPath(obj, path) {
  const keys = path.split('.')
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[k]
    if (cur == null) return undefined
  }
  return cur
}

/**
 * Write a dotted path into an object, creating intermediate objects.
 */
export function setPath(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  let cur = obj
  for (const k of keys) {
    if (!(k in cur) || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k]
  }
  cur[last] = value
  return obj
}

/**
 * Collapse a field map into the plain value object the deterministic engines consume.
 */
export function toValues(fields) {
  const out = {}
  for (const f of Object.values(fields)) {
    if (f && typeof f === 'object' && 'path' in f) {
      setPath(out, f.path, f.value)
    }
  }
  return out
}
