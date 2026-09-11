"""Pattern extractor — deterministic evidence reading for uploaded documents.

Used when no model is configured, and alongside the evidence agent to fill
fields it did not record. It reads clearly labelled lines (``Label: value``, or
a label followed by two or more spaces), exactly as printed, and cites the line
it read. It never infers: a field it cannot find is not guessed. The router
then inserts a zero-confidence placeholder, so the confidence gate hands the
field to the officer.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from ..core.constants import PROVENANCE
from ..extraction.schema import EVIDENCE_SPEC, field
from .normalise import number_list, parse_date, parse_number

EXACT_CONFIDENCE = 0.93
LONG_TEXT_CONFIDENCE = 0.90

LABELS: Dict[str, List[str]] = {
    "applicant.name": [r"name", r"applicant name", r"full name"],
    "applicant.dob": [r"date of birth", r"dob", r"d\.o\.b\.?", r"birth date"],
    "applicant.gender": [r"gender", r"sex"],
    "applicant.id_number": [r"aadhaar(?: no\.?| number)?", r"uid(?: no\.?)?", r"aadhaar id"],
    "applicant.address": [r"address", r"residential address"],
    "applicant.mobile": [r"mobile(?: no\.?| number)?", r"phone"],
    "applicant.pan": [r"pan(?: no\.?| number)?", r"permanent account number"],
    "applicant.pan_name": [r"name", r"name on pan"],
    "bank.account_holder_name": [r"account holder(?: name)?", r"customer name", r"name"],
    "bank.account_number": [r"account (?:no\.?|number)", r"a/c(?: no\.?)?"],
    "bank.bank_name": [r"bank(?: name)?"],
    "bank.ifsc": [r"ifsc(?: code)?"],
    "bank.address": [r"address", r"customer address"],
    "bank.period": [r"statement period", r"period"],
    "bank.monthly_credits": [r"monthly (?:qualifying )?credits", r"credits by month"],
    "bank.monthly_cash_deposits": [r"monthly cash deposits", r"cash deposits by month"],
    "bank.average_monthly_balance": [r"average (?:monthly )?balance", r"amb"],
    "bank.bounce_count": [r"returned debits", r"bounces?", r"cheque returns"],
    "platform.provider": [r"platform", r"provider", r"aggregator"],
    "platform.partner_id": [r"(?:partner|driver|captain) id"],
    "platform.monthly_net": [r"monthly net(?: settlements?)?", r"net settlements? by month"],
    "platform.active_months": [r"active months", r"months active"],
    "platform.rating": [r"(?:partner )?rating"],
    "invoice.dealer_name": [r"dealer(?: name)?", r"seller"],
    "invoice.invoice_number": [r"invoice (?:no\.?|number)"],
    "invoice.model": [r"(?:vehicle )?model"],
    "invoice.vehicle_category": [r"vehicle category", r"category", r"segment"],
    "invoice.chassis_number": [r"chassis (?:no\.?|number)", r"vin"],
    "invoice.ex_showroom": [r"ex[- ]?showroom(?: price)?"],
    "invoice.insurance": [r"insurance"],
    "invoice.registration": [r"registration(?: & rto)?", r"rto"],
    "invoice.accessories": [r"accessories"],
    "invoice.on_road_price": [r"on[- ]?road price", r"total on[- ]?road"],
    "invoice.subsidy": [r"(?:fame |state )?subsidy(?: applied)?"],
}

# Fields a decision cannot be made without, by document type. Missing ones become
# zero-confidence placeholders, which the confidence gate holds for the officer.
REQUIRED_BY_DOC: Dict[str, List[str]] = {
    "AADHAAR": ["applicant.name", "applicant.dob", "applicant.id_number", "applicant.address"],
    "PAN": ["applicant.pan", "applicant.pan_name"],
    "BANK_STATEMENT": ["bank.account_holder_name", "bank.account_number", "bank.monthly_credits", "bank.recurring_debits"],
    "PLATFORM_EARNINGS": ["platform.monthly_net"],
    "DEALER_INVOICE": ["invoice.on_road_price", "invoice.ex_showroom", "invoice.chassis_number", "invoice.vehicle_category"],
}

_SEP = r"\s*(?::|-|–|—|=|\s{2,})\s*"
_RECURRING = re.compile(
    r"^\s*(?:recurring (?:debit|obligation)s?|emi)" + _SEP + r"(?P<label>.+?)\s*[,|;]\s*(?:rs\.?|₹|inr)?\s*(?P<amount>\d[\d,]*(?:\.\d+)?)\s*$",
    re.I,
)
_RECURRING_NONE = re.compile(r"^\s*recurring (?:debit|obligation)s?" + _SEP + r"(?:none|nil|no[- ]?obligations?)\s*$", re.I)


def _line_value(line: str, labels: List[str]) -> Optional[str]:
    for label in labels:
        m = re.match(rf"^\s*(?:{label}){_SEP}(?P<value>\S.*?)\s*$", line, re.I)
        if m:
            return m.group("value")
    return None


def _segment_code(text: str, segments: Dict[str, Any]) -> str:
    t = text.strip().lower().replace(" ", "_")
    for code, seg in segments.items():
        if t == code.lower() or text.strip().lower() == str(seg.get("label", "")).lower():
            return code
    return text.strip()


def _typed(spec: Dict[str, Any], raw: str, segments: Dict[str, Any]):
    kind = spec["type"]
    if kind in ("money", "number"):
        return parse_number(raw)
    if kind == "list":
        values = number_list(raw)
        return values or None
    if kind == "date":
        return parse_date(raw)
    if spec["path"] == "invoice.vehicle_category":
        return _segment_code(raw, segments)
    return raw.strip() or None


def extract_patterns(document: Dict[str, Any], segments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    pages: List[str] = list(document.get("_pages_text") or [])
    doc_type = document.get("type")
    specs = [s for s in EVIDENCE_SPEC if s.get("doc") == doc_type and not s.get("derived") and not s.get("declared")]
    out: Dict[str, Any] = {}

    def cite(page: int, line: str) -> Dict[str, Any]:
        return {
            "document": document.get("filename"),
            "document_id": document.get("id"),
            "page": page,
            "snippet": line.strip()[:160],
            "method": "pattern",
        }

    for spec in specs:
        labels = LABELS.get(spec["path"])
        if not labels:
            continue
        for page_no, text in enumerate(pages, start=1):
            hit = None
            for line in text.splitlines():
                raw = _line_value(line, labels)
                if raw is None:
                    continue
                value = _typed(spec, raw, segments or {})
                if value is not None:
                    hit = (value, line)
                    break
            if hit:
                value, line = hit
                conf = LONG_TEXT_CONFIDENCE if spec["type"] == "text" and len(str(value)) > 40 else EXACT_CONFIDENCE
                out[spec["path"]] = field(spec["path"], value, confidence=conf, provenance=PROVENANCE.EXTRACTED, citation=cite(page_no, line), raw=line.strip())
                break

    if doc_type == "BANK_STATEMENT":
        debits, first = [], None
        for page_no, text in enumerate(pages, start=1):
            for line in text.splitlines():
                if _RECURRING_NONE.match(line):
                    first = first or (page_no, line)
                    continue
                m = _RECURRING.match(line)
                if m:
                    first = first or (page_no, line)
                    debits.append(
                        {
                            "label": m.group("label").strip(),
                            "amount": parse_number(m.group("amount")),
                            "kind": "LOAN_EMI",
                            "source": f"{document.get('filename')} p.{page_no}",
                        }
                    )
        if first:
            out["bank.recurring_debits"] = field(
                "bank.recurring_debits", debits, confidence=EXACT_CONFIDENCE, provenance=PROVENANCE.EXTRACTED,
                citation=cite(*first), raw=first[1].strip(),
            )
    return out


def placeholders(document: Dict[str, Any], found: Dict[str, Any]) -> Dict[str, Any]:
    """Zero-confidence fields for everything required but not read. The gate holds them for the officer."""
    out = {}
    for path in REQUIRED_BY_DOC.get(document.get("type"), []):
        if path in found:
            continue
        is_debits = path == "bank.recurring_debits"
        out[path] = field(
            path,
            [] if is_debits else None,
            confidence=0.0,
            provenance=PROVENANCE.EXTRACTED,
            citation={
                "document": document.get("filename"),
                "document_id": document.get("id"),
                "page": 1,
                "snippet": (
                    "No recurring-debit summary found — officer to confirm existing obligations"
                    if is_debits
                    else "Not found in the document — officer to supply"
                ),
                "method": "missing",
            },
        )
    return out
