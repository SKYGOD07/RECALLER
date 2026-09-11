"""RECALLER - core constants and enumerations."""

ENGINE_VERSION = "1.0.0"
WORKFLOW_VERSION = "recaller-master@1.0.0"


class DECISIONS:
    APPROVE = "APPROVE"
    REFER = "REFER"
    REJECT = "REJECT"

    ALL = (APPROVE, REFER, REJECT)


class APP_STATUS:
    DRAFT = "DRAFT"
    PROCESSING = "PROCESSING"
    WAITING_FOR_OFFICER = "WAITING_FOR_OFFICER"
    APPROVED = "APPROVED"
    REFERRED = "REFERRED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


STATUS_LABELS = {
    APP_STATUS.DRAFT: "Draft",
    APP_STATUS.PROCESSING: "Processing",
    APP_STATUS.WAITING_FOR_OFFICER: "Waiting for officer",
    APP_STATUS.APPROVED: "Approved",
    APP_STATUS.REFERRED: "Referred",
    APP_STATUS.REJECTED: "Rejected",
    APP_STATUS.COMPLETED: "Completed",
    APP_STATUS.FAILED: "Failed",
}


class FINDING_STATUS:
    MATCHED = "MATCHED"
    ADVISORY = "ADVISORY"
    BLOCKING = "BLOCKING"
    MISMATCH = "MISMATCH"


class DOC_TYPES:
    AADHAAR = "AADHAAR"
    PAN = "PAN"
    DRIVING_LICENCE = "DRIVING_LICENCE"
    BANK_STATEMENT = "BANK_STATEMENT"
    PLATFORM_EARNINGS = "PLATFORM_EARNINGS"
    DEALER_INVOICE = "DEALER_INVOICE"
    UTILITY_BILL = "UTILITY_BILL"


DOC_LABELS = {
    DOC_TYPES.AADHAAR: "Aadhaar",
    DOC_TYPES.PAN: "PAN card",
    DOC_TYPES.DRIVING_LICENCE: "Driving licence",
    DOC_TYPES.BANK_STATEMENT: "Bank statement",
    DOC_TYPES.PLATFORM_EARNINGS: "Platform earnings statement",
    DOC_TYPES.DEALER_INVOICE: "Dealer invoice",
    DOC_TYPES.UTILITY_BILL: "Utility bill",
}

REQUIRED_DOCS = [
    DOC_TYPES.AADHAAR,
    DOC_TYPES.PAN,
    DOC_TYPES.BANK_STATEMENT,
    DOC_TYPES.DEALER_INVOICE,
]

OPTIONAL_DOCS = [
    DOC_TYPES.PLATFORM_EARNINGS,
    DOC_TYPES.DRIVING_LICENCE,
    DOC_TYPES.UTILITY_BILL,
]


class PROVENANCE:
    EXTRACTED = "EXTRACTED"  # read from a document by the extraction layer
    OFFICER = "OFFICER"  # supplied or confirmed by a human
    COMPUTED = "COMPUTED"  # produced by the deterministic engine
    POLICY = "POLICY"  # read from the policy document
    DECLARED = "DECLARED"  # stated by the applicant, unverified
