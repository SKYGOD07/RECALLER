"""RECALLER — extraction layer adapters and confidence gating."""

from datetime import datetime
import inspect
import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from ..core.constants import DOC_TYPES, PROVENANCE
from ..core.hash import hash_value, rng
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

    def extract(self, document: Dict[str, Any], seed: str) -> Dict[str, Any]:
        doc_id = document.get("id", "")
        next_prng = rng(f"{seed}:{doc_id}")
        payload = document.get("payload") or {}
        degrade = document.get("degrade") or {}
        page_map = document.get("pageMap") or {}
        out = {}

        doc_type = document.get("type")
        for spec in EVIDENCE_SPEC:
            if spec.get("doc") == doc_type:
                p = spec["path"]
                val = get_path(payload, p)
                if val is None:
                    continue
                forced = degrade.get(p)
                conf = forced if forced is not None else base_confidence(spec, val, next_prng)
                out[p] = field(
                    p,
                    val,
                    confidence=conf,
                    citation={
                        "document": document.get("filename", ""),
                        "document_id": doc_id,
                        "page": page_map.get(p, 1),
                        "snippet": citation_snippet(spec, val),
                    },
                    raw=val if isinstance(val, str) else None,
                )
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


async def extract_bundle(
    documents: List[Dict[str, Any]],
    application: Dict[str, Any],
    adapter: Any = fixture_adapter,
    seed: Optional[str] = None,
) -> Dict[str, Any]:
    """Run the extraction stage across a document bundle."""
    actual_seed = seed or application.get("id", "RECALLER")
    fields = {}
    by_document = {}

    for doc in documents:
        if hasattr(adapter, "extract"):
            produced = adapter.extract(doc, actual_seed)
        else:
            produced = adapter(doc, actual_seed)
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
    critical_fields = conf_policy.get("critical_fields", [])

    held = []
    for f in fields.values():
        if f.get("provenance") == PROVENANCE.OFFICER:
            continue
        p = f.get("path")
        is_critical = p in critical_fields or f.get("critical", False)
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
                    "citation": f.get("citation"),
                    "reason": (
                        "Critical field extracted below the strict confidence floor"
                        if is_critical
                        else "Extracted below the confidence floor"
                    ),
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
        },
    }


def coerce(value: Any, val_type: str) -> Any:
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
    return to_values(fields)
