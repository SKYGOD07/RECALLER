/** RECALLER — shared vocabulary. Keep this the single source of truth for enums. */

export const ENGINE_VERSION = '1.0.0';
export const WORKFLOW_VERSION = 'recaller-master@1.0.0';

/** The only three verdicts RECALLER is permitted to emit. */
export const DECISIONS = { APPROVE: 'APPROVE', REFER: 'REFER', REJECT: 'REJECT' };

/** Lifecycle of an application in the officer console. */
export const APP_STATUS = {
  DRAFT: 'DRAFT',
  PROCESSING: 'PROCESSING',
  WAITING_FOR_OFFICER: 'WAITING_FOR_OFFICER',
  APPROVED: 'APPROVED',
  REFERRED: 'REFERRED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
};

export const STATUS_LABELS = {
  DRAFT: 'Draft',
  PROCESSING: 'Processing',
  WAITING_FOR_OFFICER: 'Waiting for officer',
  APPROVED: 'Approved',
  REFERRED: 'Referred',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

/** Reconciliation finding states. */
export const FINDING_STATUS = {
  MATCHED: 'MATCHED',
  ADVISORY: 'ADVISORY',
  BLOCKING: 'BLOCKING',
  MISMATCH: 'MISMATCH',
};

export const DOC_TYPES = {
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  DRIVING_LICENCE: 'DRIVING_LICENCE',
  BANK_STATEMENT: 'BANK_STATEMENT',
  PLATFORM_EARNINGS: 'PLATFORM_EARNINGS',
  DEALER_INVOICE: 'DEALER_INVOICE',
  UTILITY_BILL: 'UTILITY_BILL',
};

export const DOC_LABELS = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN card',
  DRIVING_LICENCE: 'Driving licence',
  BANK_STATEMENT: 'Bank statement',
  PLATFORM_EARNINGS: 'Platform earnings statement',
  DEALER_INVOICE: 'Dealer invoice',
  UTILITY_BILL: 'Utility bill',
};

/** Documents the workflow refuses to start without. */
export const REQUIRED_DOCS = [
  DOC_TYPES.AADHAAR,
  DOC_TYPES.PAN,
  DOC_TYPES.BANK_STATEMENT,
  DOC_TYPES.DEALER_INVOICE,
];

export const OPTIONAL_DOCS = [
  DOC_TYPES.PLATFORM_EARNINGS,
  DOC_TYPES.DRIVING_LICENCE,
  DOC_TYPES.UTILITY_BILL,
];

/** Provenance of a value. The UI renders this so nobody mistakes an LLM read for a computation. */
export const PROVENANCE = {
  EXTRACTED: 'EXTRACTED', // read from a document by the extraction layer
  OFFICER: 'OFFICER', // supplied or confirmed by a human
  COMPUTED: 'COMPUTED', // produced by the deterministic engine
  POLICY: 'POLICY', // read from the policy document
  DECLARED: 'DECLARED', // stated by the applicant, unverified
};
