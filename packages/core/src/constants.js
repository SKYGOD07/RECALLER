/**
 * RECALLER — core constants and enumerations.
 *
 * JavaScript port of recaller/core/constants.py.
 * Every value here is used identically by both the Python backend and the
 * in-process browser engine so that a record produced client-side is
 * byte-for-byte the record the backend would have produced.
 */

export const ENGINE_VERSION = '1.0.0'
export const WORKFLOW_VERSION = 'recaller-master@1.0.0'

export const DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REFER: 'REFER',
  REJECT: 'REJECT',
  ALL: ['APPROVE', 'REFER', 'REJECT'],
})

export const APP_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PROCESSING: 'PROCESSING',
  WAITING_FOR_OFFICER: 'WAITING_FOR_OFFICER',
  APPROVED: 'APPROVED',
  REFERRED: 'REFERRED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
})

export const STATUS_LABELS = Object.freeze({
  [APP_STATUS.DRAFT]: 'Draft',
  [APP_STATUS.PROCESSING]: 'Processing',
  [APP_STATUS.WAITING_FOR_OFFICER]: 'Waiting for officer',
  [APP_STATUS.APPROVED]: 'Approved',
  [APP_STATUS.REFERRED]: 'Referred',
  [APP_STATUS.REJECTED]: 'Rejected',
  [APP_STATUS.COMPLETED]: 'Completed',
  [APP_STATUS.FAILED]: 'Failed',
})

export const FINDING_STATUS = Object.freeze({
  MATCHED: 'MATCHED',
  ADVISORY: 'ADVISORY',
  BLOCKING: 'BLOCKING',
  MISMATCH: 'MISMATCH',
})

export const DOC_TYPES = Object.freeze({
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  DRIVING_LICENCE: 'DRIVING_LICENCE',
  BANK_STATEMENT: 'BANK_STATEMENT',
  PLATFORM_EARNINGS: 'PLATFORM_EARNINGS',
  DEALER_INVOICE: 'DEALER_INVOICE',
  UTILITY_BILL: 'UTILITY_BILL',
})

export const DOC_LABELS = Object.freeze({
  [DOC_TYPES.AADHAAR]: 'Aadhaar',
  [DOC_TYPES.PAN]: 'PAN card',
  [DOC_TYPES.DRIVING_LICENCE]: 'Driving licence',
  [DOC_TYPES.BANK_STATEMENT]: 'Bank statement',
  [DOC_TYPES.PLATFORM_EARNINGS]: 'Platform earnings statement',
  [DOC_TYPES.DEALER_INVOICE]: 'Dealer invoice',
  [DOC_TYPES.UTILITY_BILL]: 'Utility bill',
})

export const REQUIRED_DOCS = [
  DOC_TYPES.AADHAAR,
  DOC_TYPES.PAN,
  DOC_TYPES.BANK_STATEMENT,
  DOC_TYPES.DEALER_INVOICE,
]

export const OPTIONAL_DOCS = [
  DOC_TYPES.PLATFORM_EARNINGS,
  DOC_TYPES.DRIVING_LICENCE,
  DOC_TYPES.UTILITY_BILL,
]

export const PROVENANCE = Object.freeze({
  EXTRACTED: 'EXTRACTED',
  OFFICER: 'OFFICER',
  COMPUTED: 'COMPUTED',
  POLICY: 'POLICY',
  DECLARED: 'DECLARED',
})
