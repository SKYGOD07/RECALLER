"""RECALLER tools for review and narration agents.

All read-only, all over one finished record, plus ``flag_issue``, which only
records a finding for the officer. There is deliberately no tool that runs the
credit engine or the policy engine: an agent that could feed its own inputs to
the engine could manufacture a figure. Agents quote the figures the pipeline
already produced.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .registry import ToolRegistry
from .schemas import ReviewFinding

_GROUPS = ["applicant", "bank", "platform", "invoice"]


def _compact_field(f: Dict[str, Any]) -> Dict[str, Any]:
    cit = f.get("citation") or {}
    return {
        "path": f.get("path"),
        "label": f.get("label"),
        "value": f.get("value"),
        "confidence": round(float(f.get("confidence") or 0), 3),
        "provenance": f.get("provenance"),
        "citation": {"document": cit.get("document"), "page": cit.get("page"), "snippet": cit.get("snippet")},
        **({"superseded": f["superseded"]} if f.get("superseded") else {}),
    }


def evidence_slice(record: Dict[str, Any], group: str | None = None) -> List[Dict[str, Any]]:
    fields = (record.get("evidence") or {}).get("fields") or {}
    return [_compact_field(f) for p, f in sorted(fields.items()) if group is None or p.startswith(f"{group}.")]


def build_review_registry(record: Dict[str, Any], sink: List[Dict[str, Any]]) -> ToolRegistry:
    rec = record.get("reconciliation") or {}
    credit = record.get("credit") or {}
    policy_eval = record.get("policyEvaluation") or {}
    decision = record.get("decision") or {}
    reg = ToolRegistry()

    reg.register(
        "read_evidence",
        lambda a: {"fields": evidence_slice(record, a.get("group"))},
        toolset="review",
        description="Read extracted evidence fields with confidence, provenance and citation. Optionally filter by group.",
        parameters={"type": "object", "properties": {"group": {"type": "string", "enum": _GROUPS}}},
    )
    reg.register(
        "get_reconciliation",
        lambda a: {
            "summary": {k: rec.get(k) for k in ("total", "blocking", "advisory", "matched")},
            "findings": [
                {k: f.get(k) for k in ("code", "label", "status", "severity", "note", "delta", "delta_pct", "similarity", "comparison")}
                for f in rec.get("findings", [])
            ],
        },
        toolset="review",
        description="Read the cross-document reconciliation findings exactly as the engine graded them.",
    )
    reg.register(
        "get_credit_result",
        lambda a: {
            "note": "Computed by the deterministic credit engine. Quote these figures; never recompute them.",
            "metrics": credit.get("metrics"),
            "income_breakdown": credit.get("income_breakdown"),
            "input_hash": credit.get("input_hash"),
        },
        toolset="review",
        description="Read the credit engine's output for this file (read-only).",
    )
    reg.register(
        "get_policy_result",
        lambda a: {
            "decision": decision.get("decision"),
            "reason_codes": decision.get("reason_codes"),
            "rules": [{k: r.get(k) for k in ("code", "label", "outcome", "detail")} for r in policy_eval.get("rules", [])],
            "policy": f"{policy_eval.get('policy_id')} v{policy_eval.get('policy_version')}",
        },
        toolset="review",
        description="Read the policy engine's verdict, reason codes and rule outcomes (read-only).",
    )

    def flag(args: Dict[str, Any]) -> Dict[str, Any]:
        finding = ReviewFinding.model_validate(args)  # a malformed flag is refused with the validation error
        sink.append(finding.model_dump())
        return {"ok": True, "recorded": len(sink)}

    reg.register(
        "flag_issue",
        flag,
        toolset="review",
        description="Record a finding for the officer. Findings are advisory; they never change the decision.",
        parameters=ReviewFinding.model_json_schema(),
    )
    reg.register(
        "read_decision",
        lambda a: {
            "decision": decision.get("decision"),
            "reason_codes": decision.get("reason_codes"),
            "headline": record.get("headline"),
            "memo_sections": [
                {"id": s.get("id"), "title": s.get("title"), "body": s.get("body")}
                for s in (record.get("memo") or {}).get("sections", [])
                if s.get("body")
            ],
        },
        toolset="narration",
        description="Read the finished decision, reason codes and memo text.",
    )
    return reg
