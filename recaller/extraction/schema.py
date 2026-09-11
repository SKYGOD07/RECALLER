"""RECALLER — evidence schema."""

from typing import Any, Dict, List, Optional
from ..core.constants import DOC_TYPES, PROVENANCE

EVIDENCE_SPEC = [
    {"path": "applicant.name", "label": "Applicant name", "type": "text", "doc": DOC_TYPES.AADHAAR, "critical": True},
    {"path": "applicant.dob", "label": "Date of birth", "type": "date", "doc": DOC_TYPES.AADHAAR, "critical": False},
    {"path": "applicant.age", "label": "Age", "type": "number", "doc": DOC_TYPES.AADHAAR, "critical": False, "derived": True},
    {"path": "applicant.gender", "label": "Gender", "type": "text", "doc": DOC_TYPES.AADHAAR, "critical": False},
    {"path": "applicant.id_number", "label": "Aadhaar number (masked)", "type": "id", "doc": DOC_TYPES.AADHAAR, "critical": True},
    {"path": "applicant.address", "label": "KYC address", "type": "text", "doc": DOC_TYPES.AADHAAR, "critical": False},
    {"path": "applicant.pan", "label": "PAN", "type": "id", "doc": DOC_TYPES.PAN, "critical": False},
    {"path": "applicant.pan_name", "label": "Name on PAN", "type": "text", "doc": DOC_TYPES.PAN, "critical": False},
    {"path": "applicant.mobile", "label": "Mobile number", "type": "text", "doc": DOC_TYPES.AADHAAR, "critical": False},
    {"path": "applicant.declared_monthly_income", "label": "Declared monthly income", "type": "money", "doc": None, "critical": False, "declared": True},

    {"path": "bank.account_holder_name", "label": "Bank account holder name", "type": "text", "doc": DOC_TYPES.BANK_STATEMENT, "critical": True},
    {"path": "bank.account_number", "label": "Account number (masked)", "type": "id", "doc": DOC_TYPES.BANK_STATEMENT, "critical": True},
    {"path": "bank.bank_name", "label": "Bank", "type": "text", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.ifsc", "label": "IFSC", "type": "id", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.address", "label": "Address on statement", "type": "text", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.period", "label": "Statement period", "type": "text", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.monthly_credits", "label": "Monthly qualifying credits", "type": "list", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.monthly_cash_deposits", "label": "Monthly cash deposits", "type": "list", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.average_monthly_balance", "label": "Average monthly balance", "type": "money", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.bounce_count", "label": "Returned debits", "type": "number", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},
    {"path": "bank.recurring_debits", "label": "Recurring obligations detected", "type": "list", "doc": DOC_TYPES.BANK_STATEMENT, "critical": False},

    {"path": "platform.provider", "label": "Earnings platform", "type": "text", "doc": DOC_TYPES.PLATFORM_EARNINGS, "critical": False},
    {"path": "platform.partner_id", "label": "Partner / driver ID", "type": "id", "doc": DOC_TYPES.PLATFORM_EARNINGS, "critical": False},
    {"path": "platform.monthly_net", "label": "Monthly net settlements", "type": "list", "doc": DOC_TYPES.PLATFORM_EARNINGS, "critical": False},
    {"path": "platform.active_months", "label": "Active months on platform", "type": "number", "doc": DOC_TYPES.PLATFORM_EARNINGS, "critical": False},
    {"path": "platform.rating", "label": "Partner rating", "type": "number", "doc": DOC_TYPES.PLATFORM_EARNINGS, "critical": False},

    {"path": "invoice.dealer_name", "label": "Dealer", "type": "text", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.invoice_number", "label": "Invoice number", "type": "id", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.model", "label": "Vehicle model", "type": "text", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.vehicle_category", "label": "Vehicle category", "type": "text", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.chassis_number", "label": "Chassis number", "type": "id", "doc": DOC_TYPES.DEALER_INVOICE, "critical": True},
    {"path": "invoice.ex_showroom", "label": "Ex-showroom price", "type": "money", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.insurance", "label": "Insurance", "type": "money", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.registration", "label": "Registration & RTO", "type": "money", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.accessories", "label": "Accessories", "type": "money", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},
    {"path": "invoice.on_road_price", "label": "On-road price", "type": "money", "doc": DOC_TYPES.DEALER_INVOICE, "critical": True},
    {"path": "invoice.subsidy", "label": "FAME / state subsidy applied", "type": "money", "doc": DOC_TYPES.DEALER_INVOICE, "critical": False},

    # Informal-lender reference. A named third party who has actually lent to
    # this borrower states what they lent and how they were repaid. It is an
    # attestation, never a verification: it can add an obligation the bank
    # statement never showed, and it can corroborate a repayment record no
    # bureau holds, but it can never on its own loosen a policy limit.
    {"path": "informant.name", "label": "Informant name", "type": "text", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.relationship", "label": "Lending relationship", "type": "text", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.business_name", "label": "Informant business", "type": "text", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.contact", "label": "Informant contact (masked)", "type": "text", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.contact_verified", "label": "Contact verified by officer", "type": "flag", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.borrower_known_as", "label": "Borrower known to informant as", "type": "text", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.months_known", "label": "Months of lending relationship", "type": "number", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.principal_lent", "label": "Total principal lent", "type": "money", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.current_outstanding", "label": "Currently outstanding", "type": "money", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": True, "attested": True},
    {"path": "informant.monthly_repayment", "label": "Monthly repayment to informant", "type": "money", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": True, "attested": True},
    {"path": "informant.missed_payments_12m", "label": "Missed payments (last 12 months)", "type": "number", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.longest_delay_days", "label": "Longest delay (days)", "type": "number", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.would_lend_again", "label": "Would lend again", "type": "flag", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.attested_at", "label": "Attested on", "type": "date", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
    {"path": "informant.note", "label": "Informant note", "type": "text", "doc": DOC_TYPES.INFORMANT_REFERENCE, "critical": False, "attested": True},
]

SPEC_BY_PATH = {s["path"]: s for s in EVIDENCE_SPEC}


def field(
    path: str,
    value: Any,
    confidence: float = 1.0,
    citation: Optional[Dict[str, Any]] = None,
    provenance: str = PROVENANCE.EXTRACTED,
    raw: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a well-formed EvidenceField dictionary."""
    spec = SPEC_BY_PATH.get(path, {})
    return {
        "path": path,
        "label": spec.get("label", path),
        "type": spec.get("type", "text"),
        "critical": spec.get("critical", False),
        "value": value,
        "confidence": max(0.0, min(1.0, float(confidence))),
        "provenance": provenance,
        "citation": citation,
        "raw": raw,
    }


def get_path(obj: Dict[str, Any], path: str) -> Any:
    """Read a dotted path out of a nested dictionary."""
    keys = path.split(".")
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


def set_path(obj: Dict[str, Any], path: str, value: Any) -> Dict[str, Any]:
    """Write a dotted path into a dictionary, creating intermediate dicts."""
    keys = path.split(".")
    last = keys.pop()
    cur = obj
    for k in keys:
        if k not in cur or not isinstance(cur[k], dict):
            cur[k] = {}
        cur = cur[k]
    cur[last] = value
    return obj


def to_values(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Collapse a field map into the plain value object the deterministic engines consume."""
    out: Dict[str, Any] = {}
    for f in fields.values():
        if isinstance(f, dict) and "path" in f:
            set_path(out, f["path"], f.get("value"))
    return out
