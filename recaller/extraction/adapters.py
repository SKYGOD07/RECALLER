"""RECALLER — extraction layer adapters and confidence gating."""

from datetime import datetime
import inspect
import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from ..core.constants import DOC_TYPES, PROVENANCE
from ..core.hash import hash_value, rng
from .informant import attestation_quality, confidence_for, is_attested
from .schema import EVIDENCE_SPEC, SPEC_BY_PATH, field, get_path, to_values


def citation_snippet(spec: Dict[str, Any], value: Any) -> str:
    if isinstance(value, list):
        return f"{spec.get('label')}: {len(value)} monthly values"
    if spec.get("type") == "money":
        try:
            return f"{spec.get('label')}: ₹{int(float(value)):,}"
        except (ValueError, TypeError):
            return f"{spec.get('label')}: ₹{value}"
    return f"{spec.get('label')}: {str(value)[:64]}"


def base_confidence(spec: Dict[str, Any], value: Any, next_prng: Any) -> float:
    c = 0.975
    if spec.get("type") == "text" and len(str(value or "")) > 40:
        c -= 0.05
    if spec.get("type") == "id":
        c -= 0.01
    if spec.get("type") == "list":
        c -= 0.008
    if spec.get("doc") == DOC_TYPES.BANK_STATEMENT:
        c -= 0.015
    if spec.get("doc") == DOC_TYPES.PLATFORM_EARNINGS:
        c -= 0.008
    c -= next_prng() * 0.05
    return max(0.35, min(0.999, c))


class FixtureAdapter:
    name = "fixture"

    def extract(self, document: Dict[str, Any], seed: str, policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        doc_id = document.get("id", "")
        next_prng = rng(f"{seed}:{doc_id}")
        payload = document.get("payload") or {}
        degrade = document.get("degrade") or {}
        page_map = document.get("pageMap") or {}
        out = {}

        doc_type = document.get("type")

        # An informal-lender reference is not parsed out of a scan — it is a
        # statement someone signed. Its confidence comes from how well that
        # statement holds together, computed once for the whole reference.
        quality = None
        if doc_type == DOC_TYPES.INFORMANT_REFERENCE:
            quality = attestation_quality(payload.get("informant") or {}, policy or {})

        for spec in EVIDENCE_SPEC:
            if spec.get("doc") == doc_type:
                p = spec["path"]
                val = get_path(payload, p)
                if val is None:
                    continue
                forced = degrade.get(p)
                if forced is not None:
                    conf = forced
                elif quality is not None:
                    conf = confidence_for(p, payload.get("informant") or {}, policy or {}, quality)
                else:
                    conf = base_confidence(spec, val, next_prng)
                out[p] = field(
                    p,
                    val,
                    confidence=conf,
                    provenance=PROVENANCE.INFORMANT if quality is not None else PROVENANCE.EXTRACTED,
                    citation={
                        "document": document.get("filename", ""),
                        "document_id": doc_id,
                        "page": page_map.get(p, 1),
                        "snippet": citation_snippet(spec, val),
                    },
                    raw=val if isinstance(val, str) else None,
                )

        if quality is not None and out:
            # The scoring is part of the evidence, not a hidden step: every
            # informant field carries the reference's quality breakdown so the
            # console and the memo can show why the number is what it is.
            for f in out.values():
                f["attested"] = True
                f["attestation"] = quality
        return out


fixture_adapter = FixtureAdapter()


def age_from(dob_iso: str, as_of_iso: Optional[str] = None) -> int:
    try:
        dob = datetime.fromisoformat(dob_iso.replace("Z", "+00:00"))
        if as_of_iso:
            as_of = datetime.fromisoformat(as_of_iso.replace("Z", "+00:00"))
        else:
            as_of = datetime.utcnow()
        age = as_of.year - dob.year
        if (as_of.month, as_of.day) < (dob.month, dob.day):
            age -= 1
        return age
    except Exception:
        return 30


def _call_adapter(adapter: Any, doc: Dict[str, Any], seed: str, policy: Dict[str, Any]) -> Any:
    """Invoke an adapter, passing policy only to adapters that accept it.

    Third-party adapters predate the informant reference and take two
    arguments. Rather than break them, ask.
    """
    fn = adapter.extract if hasattr(adapter, "extract") else adapter
    try:
        takes_policy = "policy" in inspect.signature(fn).parameters
    except (TypeError, ValueError):
        takes_policy = False
    return fn(doc, seed, policy) if takes_policy else fn(doc, seed)


async def extract_bundle(
    documents: List[Dict[str, Any]],
    application: Dict[str, Any],
    adapter: Any = fixture_adapter,
    seed: Optional[str] = None,
    policy: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run the extraction stage across a document bundle."""
    actual_seed = seed or application.get("id", "RECALLER")
    fields = {}
    by_document = {}

    for doc in documents:
        produced = _call_adapter(adapter, doc, actual_seed, policy or {})
        if inspect.isawaitable(produced):
            produced = await produced
        by_document[doc.get("id")] = list(produced.keys())
        fields.update(produced)

    # Stated income
    declared_inc = application.get("declared_monthly_income")
    if declared_inc is not None:
        fields["applicant.declared_monthly_income"] = field(
            "applicant.declared_monthly_income",
            declared_inc,
            confidence=1.0,
            provenance=PROVENANCE.DECLARED,
            citation={"document": "Application form", "page": 1, "snippet": "Stated by applicant"},
        )

    # Derived age
    dob = fields.get("applicant.dob")
    if dob and dob.get("value"):
        age_val = age_from(dob["value"], application.get("created_at"))
        fields["applicant.age"] = field(
            "applicant.age",
            age_val,
            confidence=dob.get("confidence", 1.0),
            provenance=PROVENANCE.COMPUTED,
            citation={
                **(dob.get("citation") or {}),
                "snippet": f"Derived from date of birth {dob['value']}",
            },
        )

    field_list = list(fields.values())
    confs = [f.get("confidence", 1.0) for f in field_list]

    stats = {
        "total": len(field_list),
        "mean_confidence": sum(confs) / len(confs) if confs else 0.0,
        "min_confidence": min(confs) if confs else 0.0,
        "adapter": getattr(adapter, "name", "custom"),
    }

    # Hash matches JS: Object.fromEntries(list.map((f) => [f.path, [f.value, f.confidence]]))
    hash_payload = {f["path"]: [f.get("value"), f.get("confidence")] for f in field_list}

    return {
        "fields": fields,
        "byDocument": by_document,
        "stats": stats,
        "extraction_hash": hash_value(hash_payload),
    }


def apply_confidence_gate(fields: Dict[str, Any], policy: Dict[str, Any]) -> Dict[str, Any]:
    """Hold back fields below confidence floor for human review."""
    conf_policy = policy.get("confidence", {})
    field_threshold = conf_policy.get("field_threshold", 0.80)
    critical_field_threshold = conf_policy.get("critical_field_threshold", 0.88)
    # Attested evidence is structurally capped below the extraction floors — a
    # signed statement can never score like a parsed document. Holding it to the
    # same bar would route every informal-lender reference to a human and teach
    # officers to rubber-stamp the queue. It gets its own, honestly lower, bar.
    attested_threshold = conf_policy.get("attested_field_threshold", 0.55)
    attested_critical_threshold = conf_policy.get("attested_critical_field_threshold", 0.66)
    critical_fields = conf_policy.get("critical_fields", [])

    held = []
    for f in fields.values():
        if f.get("provenance") == PROVENANCE.OFFICER:
            continue
        p = f.get("path")
        is_critical = p in critical_fields or f.get("critical", False)
        attested = is_attested(f)
        if attested:
            floor = attested_critical_threshold if is_critical else attested_threshold
        else:
            floor = critical_field_threshold if is_critical else field_threshold
        conf = f.get("confidence", 1.0)
        if conf < floor:
            held.append(
                {
                    "path": p,
                    "label": f.get("label"),
                    "value": f.get("value"),
                    "type": f.get("type"),
                    "confidence": conf,
                    "floor": floor,
                    "critical": is_critical,
                    "attested": attested,
                    "citation": f.get("citation"),
                    "reason": _hold_reason(attested, is_critical, f),
                    "status": "PENDING",
                }
            )

    # Sort critical first, then lowest confidence first
    held.sort(key=lambda h: (-int(h["critical"]), h["confidence"]))

    return {
        "passed": len(held) == 0,
        "held": held,
        "thresholds": {
            "field_threshold": field_threshold,
            "critical_field_threshold": critical_field_threshold,
            "attested_field_threshold": attested_threshold,
            "attested_critical_field_threshold": attested_critical_threshold,
        },
    }


def _hold_reason(attested: bool, is_critical: bool, f: Dict[str, Any]) -> str:
    """Say why a field is in the queue, in terms the officer can act on."""
    if attested:
        problems = ((f.get("attestation") or {}).get("coherence") or {}).get("problems") or []
        if problems:
            return "Informant reference does not add up: " + problems[0].get("detail", "")
        attestation = f.get("attestation") or {}
        if not attestation.get("contact_verified", True):
            return "Informant contact has not been verified by an officer"
        return "Third-party attestation below the floor for attested evidence"
    return (
        "Critical field extracted below the strict confidence floor"
        if is_critical
        else "Extracted below the confidence floor"
    )


def coerce(value: Any, val_type: str) -> Any:
    if val_type == "flag":
        if isinstance(value, bool):
            return value
        return str(value).strip().upper() in ("TRUE", "YES", "Y", "1", "VERIFIED")
    if val_type in ("money", "number"):
        try:
            cleaned = re.sub(r"[,\s₹]", "", str(value))
            return float(cleaned) if "." in cleaned else int(cleaned)
        except (ValueError, TypeError):
            return None
    if val_type == "list":
        return coerce_list(value)
    return value


def coerce_list(value: Any) -> List[Any]:
    """Officer-entered lists: "33200, 35100, …" → numbers; "Bajaj EMI 2400; Phone 1200" → obligations."""
    if isinstance(value, list):
        return value
    text = str(value or "")
    if re.search(r"[A-Za-z]", text):
        items = []
        for part in re.split(r"[;\n]", text):
            m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*$", part.strip())
            if not m:
                continue  # "none" / "nil" → no obligations
            label = part.strip()[: m.start()].strip(" -:,") or "Officer-entered obligation"
            items.append({"label": label, "amount": float(m.group(1).replace(",", "")), "kind": "LOAN_EMI", "source": "Officer entry"})
        return items
    nums = [n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)]
    return [float(n) if "." in n else int(n) for n in nums]


def apply_officer_resolutions(
    fields: Dict[str, Any], resolutions: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Fold officer resolutions (CONFIRM, EDIT, REJECT) into evidence fields."""
    if not resolutions:
        return {k: {**v} for k, v in fields.items()}

    next_fields = {k: {**v} for k, v in fields.items()}
    for r in resolutions:
        path = r.get("path")
        orig = next_fields.get(path)
        if not orig:
            continue
        now_iso = r.get("at") or datetime.utcnow().isoformat() + "Z"
        base = {
            **orig,
            "provenance": PROVENANCE.OFFICER,
            "confidence": 1.0,
            "superseded": {
                "value": orig.get("value"),
                "confidence": orig.get("confidence"),
                "provenance": orig.get("provenance"),
            },
            "officer": {
                "action": r.get("action"),
                "by": r.get("by", "officer"),
                "at": now_iso,
                "note": r.get("note"),
            },
        }
        action = r.get("action")
        if action == "CONFIRM":
            next_fields[path] = base
        elif action == "EDIT":
            next_fields[path] = {
                **base,
                "value": coerce(r.get("value"), orig.get("type", "text")),
            }
        elif action == "REJECT":
            next_fields[path] = {**base, "value": None, "confidence": 0.0}

    return next_fields


def materialise(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Collapse the field map to the plain values the deterministic engines read.

    One addition beyond a straight collapse: the attestation breakdown computed
    for an informant reference travels with the values under ``_attestation``,
    so reconciliation can explain a ledger that does not add up without
    recomputing it. It is carried, never recalculated — the score the officer
    saw in the queue is the score the finding cites.
    """
    values = to_values(fields)

    attestation = None
    for f in fields.values():
        if isinstance(f, dict) and f.get("attestation"):
            attestation = f["attestation"]
            break
    if attestation is not None and isinstance(values.get("informant"), dict):
        values["informant"]["_attestation"] = attestation

    return values
