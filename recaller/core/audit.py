"""RECALLER — audit trail primitives.

Every state transition an application undergoes is appended here as an
immutable event. The ledger is hash-chained: each event carries the digest of
the one before it, so a tampered or dropped event breaks verification.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from .hash import hash_value

STAGES = (
    "APPLICATION_CREATED",
    "DOCUMENT_INGESTED",
    "KYC_EXTRACTION",
    "BANK_EXTRACTION",
    "PLATFORM_EXTRACTION",
    "INVOICE_EXTRACTION",
    "EVIDENCE_VALIDATION",
    "RECONCILIATION",
    "CONFIDENCE_GATE",
    "OFFICER_REVIEW",
    "CREDIT_CALCULATION",
    "POLICY_EVALUATION",
    "DECISION",
    "NARRATION",
    "MEMO_GENERATED",
    "REPLAY",
    "WHAT_IF",
)

STAGE_LABELS = {
    "APPLICATION_CREATED": "Application created",
    "DOCUMENT_INGESTED": "Documents ingested",
    "KYC_EXTRACTION": "KYC extraction",
    "BANK_EXTRACTION": "Bank statement extraction",
    "PLATFORM_EXTRACTION": "Platform earnings extraction",
    "INVOICE_EXTRACTION": "Dealer invoice extraction",
    "EVIDENCE_VALIDATION": "Evidence validation",
    "RECONCILIATION": "Cross-document reconciliation",
    "CONFIDENCE_GATE": "Confidence gate",
    "OFFICER_REVIEW": "Officer review",
    "CREDIT_CALCULATION": "Deterministic credit calculation",
    "POLICY_EVALUATION": "Policy evaluation",
    "DECISION": "Decision",
    "NARRATION": "Narration",
    "MEMO_GENERATED": "Credit memo generated",
    "REPLAY": "Replay",
    "WHAT_IF": "What-if simulation",
}


class ACTORS:
    SYSTEM = "SYSTEM"
    ENGINE = "ENGINE"
    LLM = "LLM"
    OFFICER = "OFFICER"
    N8N = "N8N"


def create_ledger(trace_id: str) -> Dict[str, Any]:
    """Create a new empty audit ledger."""
    return {"traceId": trace_id, "events": [], "head": "0" * 32}


def append_event(ledger: Dict[str, Any], event: Dict[str, Any]) -> Dict[str, Any]:
    """Append an event to a ledger, returning a new ledger dictionary."""
    seq = len(ledger.get("events", [])) + 1
    now_iso = event.get("at")
    if not now_iso:
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    body = {
        "seq": seq,
        "stage": event.get("stage"),
        "actor": event.get("actor", ACTORS.SYSTEM),
        "summary": event.get("summary", ""),
        "detail": event.get("detail") if event.get("detail") is not None else {},
        "durationMs": event.get("durationMs"),
        "at": now_iso,
        "prev": ledger.get("head", "0" * 32),
    }

    digest = hash_value(body)
    entry = {**body, "digest": digest, "traceId": ledger.get("traceId")}

    return {
        "traceId": ledger.get("traceId"),
        "events": [*ledger.get("events", []), entry],
        "head": digest,
    }


def verify_ledger(ledger: Dict[str, Any]) -> Dict[str, Any]:
    """Recompute the chain and report the first index where it breaks, if any."""
    prev = "0" * 32
    events = ledger.get("events", [])
    for i, e in enumerate(events):
        digest = e.get("digest")
        # Body is everything except digest and traceId
        body = {
            "seq": e.get("seq"),
            "stage": e.get("stage"),
            "actor": e.get("actor"),
            "summary": e.get("summary"),
            "detail": e.get("detail", {}),
            "durationMs": e.get("durationMs"),
            "at": e.get("at"),
            "prev": e.get("prev"),
        }
        if body["prev"] != prev:
            return {"ok": False, "brokenAt": i, "reason": "chain-link-mismatch"}
        if hash_value(body) != digest:
            return {"ok": False, "brokenAt": i, "reason": "digest-mismatch"}
        prev = digest

    return {"ok": True, "brokenAt": None, "reason": None}
