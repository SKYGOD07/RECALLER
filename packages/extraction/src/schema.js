/**
 * RECALLER — evidence schema.
 *
 * The extraction layer is the boundary between unstructured documents and the
 * deterministic core. Everything that crosses it arrives as an EvidenceField:
 * a value, a confidence, and a citation back to the page it came from. Nothing
 * downstream is allowed to consume a bare value without its confidence.
 */

import { PROVENANCE } from '../../core/src/constants.js';

/**
 * @typedef {object} EvidenceField
 * @property {string} path          dotted address, e.g. "bank.account_holder_name"
 * @property {string} label         human label for the officer console
 * @property {*}      value         normalised value
 * @property {string} type          money | text | date | number | list | id
 * @property {number} confidence    0..1
 * @property {string} provenance    EXTRACTED | OFFICER | COMPUTED | DECLARED
 * @property {object} citation      { document, page, snippet }
 * @property {*}      [raw]         the literal string as it appeared
 */

/** The fields RECALLER expects a complete bundle to yield. */
export const EVIDENCE_SPEC = [
  { path: 'applicant.name', label: 'Applicant name', type: 'text', doc: 'AADHAAR', critical: true },
  { path: 'applicant.dob', label: 'Date of birth', type: 'date', doc: 'AADHAAR', critical: false },
  { path: 'applicant.age', label: 'Age', type: 'number', doc: 'AADHAAR', critical: false, derived: true },
  { path: 'applicant.gender', label: 'Gender', type: 'text', doc: 'AADHAAR', critical: false },
  { path: 'applicant.id_number', label: 'Aadhaar number (masked)', type: 'id', doc: 'AADHAAR', critical: true },
  { path: 'applicant.address', label: 'KYC address', type: 'text', doc: 'AADHAAR', critical: false },
  { path: 'applicant.pan', label: 'PAN', type: 'id', doc: 'PAN', critical: false },
  { path: 'applicant.pan_name', label: 'Name on PAN', type: 'text', doc: 'PAN', critical: false },
  { path: 'applicant.mobile', label: 'Mobile number', type: 'text', doc: 'AADHAAR', critical: false },
  { path: 'applicant.declared_monthly_income', label: 'Declared monthly income', type: 'money', doc: null, critical: false, declared: true },

  { path: 'bank.account_holder_name', label: 'Bank account holder name', type: 'text', doc: 'BANK_STATEMENT', critical: true },
  { path: 'bank.account_number', label: 'Account number (masked)', type: 'id', doc: 'BANK_STATEMENT', critical: true },
  { path: 'bank.bank_name', label: 'Bank', type: 'text', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.ifsc', label: 'IFSC', type: 'id', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.address', label: 'Address on statement', type: 'text', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.period', label: 'Statement period', type: 'text', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.monthly_credits', label: 'Monthly qualifying credits', type: 'list', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.monthly_cash_deposits', label: 'Monthly cash deposits', type: 'list', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.average_monthly_balance', label: 'Average monthly balance', type: 'money', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.bounce_count', label: 'Returned debits', type: 'number', doc: 'BANK_STATEMENT', critical: false },
  { path: 'bank.recurring_debits', label: 'Recurring obligations detected', type: 'list', doc: 'BANK_STATEMENT', critical: false },

  { path: 'platform.provider', label: 'Earnings platform', type: 'text', doc: 'PLATFORM_EARNINGS', critical: false },
  { path: 'platform.partner_id', label: 'Partner / driver ID', type: 'id', doc: 'PLATFORM_EARNINGS', critical: false },
  { path: 'platform.monthly_net', label: 'Monthly net settlements', type: 'list', doc: 'PLATFORM_EARNINGS', critical: false },
  { path: 'platform.active_months', label: 'Active months on platform', type: 'number', doc: 'PLATFORM_EARNINGS', critical: false },
  { path: 'platform.rating', label: 'Partner rating', type: 'number', doc: 'PLATFORM_EARNINGS', critical: false },

  { path: 'invoice.dealer_name', label: 'Dealer', type: 'text', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.invoice_number', label: 'Invoice number', type: 'id', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.model', label: 'Vehicle model', type: 'text', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.vehicle_category', label: 'Vehicle category', type: 'text', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.chassis_number', label: 'Chassis number', type: 'id', doc: 'DEALER_INVOICE', critical: true },
  { path: 'invoice.ex_showroom', label: 'Ex-showroom price', type: 'money', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.insurance', label: 'Insurance', type: 'money', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.registration', label: 'Registration & RTO', type: 'money', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.accessories', label: 'Accessories', type: 'money', doc: 'DEALER_INVOICE', critical: false },
  { path: 'invoice.on_road_price', label: 'On-road price', type: 'money', doc: 'DEALER_INVOICE', critical: true },
  { path: 'invoice.subsidy', label: 'FAME / state subsidy applied', type: 'money', doc: 'DEALER_INVOICE', critical: false },
];

export const SPEC_BY_PATH = Object.fromEntries(EVIDENCE_SPEC.map((s) => [s.path, s]));

/** Build a well-formed EvidenceField. */
export function field(path, value, { confidence = 1, citation = null, provenance = PROVENANCE.EXTRACTED, raw = null } = {}) {
  const spec = SPEC_BY_PATH[path];
  return {
    path,
    label: spec?.label ?? path,
    type: spec?.type ?? 'text',
    critical: spec?.critical ?? false,
    value,
    confidence: Math.max(0, Math.min(1, confidence)),
    provenance,
    citation,
    raw,
  };
}

/** Read a dotted path out of a plain object. */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Write a dotted path into a plain object, creating intermediate objects. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
  return obj;
}

/**
 * Collapse a field map into the plain value object the deterministic engines
 * consume. Called only AFTER the confidence gate has cleared.
 */
export function toValues(fields) {
  const out = {};
  Object.values(fields).forEach((f) => setPath(out, f.path, f.value));
  return out;
}
