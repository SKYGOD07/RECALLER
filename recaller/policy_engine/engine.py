"""RECALLER — policy engine.

Consumes deterministic credit metrics plus reconciliation and confidence
state, walks the configured rule set, and returns a verdict with reason
codes. The engine holds no thresholds of its own: every number it compares
against comes out of the policy document.
"""

from typing import Any, Dict, List, Optional, Tuple, Union
from ..core.constants import DECISIONS
from ..core.hash import hash_value, short_hash


class OUTCOME:
    PASS = "PASS"
    REFER = "REFER"
    FAIL = "FAIL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


Sequence_Band = Union[List[float], Tuple[float, ...]]


def in_band(value: float, band: Optional[Sequence_Band]) -> bool:
    if not band or len(band) < 2:
        return False
    lo, hi = band[0], band[1]
    return lo <= value <= hi



def fmt(v: Any) -> str:
    if not isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, int):
        return str(v)
    # Format up to 4 decimal places without trailing zeroes
    formatted = f"{float(v):.4f}".rstrip("0").rstrip(".")
    return formatted


def evaluate_rule(rule: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate one rule against the metric bag."""
    metrics = ctx.get("metrics", {})
    segment = ctx.get("segment", {})
    metric_key = rule.get("metric")
    actual = metrics.get(metric_key)

    shell = {
        "code": rule.get("code"),
        "label": rule.get("label"),
        "metric": metric_key,
        "severity": rule.get("severity"),
        "rationale": rule.get("rationale"),
        "operator": rule.get("operator"),
    }

    if actual is None:
        return {
            **shell,
            "outcome": OUTCOME.NOT_APPLICABLE,
            "actual": None,
            "threshold": rule.get("threshold"),
            "reason": None,
            "detail": "Metric unavailable for this application.",
        }

    op = rule.get("operator")
    threshold = rule.get("threshold")
    refer_band = rule.get("refer_band")

    if op == "lte":
        if actual <= threshold:
            outcome = OUTCOME.PASS
        elif in_band(actual, refer_band):
            outcome = OUTCOME.REFER
        else:
            outcome = OUTCOME.FAIL
        sign = "≤" if actual <= threshold else ">"
        detail = f"{fmt(actual)} {sign} {fmt(threshold)}"

    elif op == "gte":
        if actual >= threshold:
            outcome = OUTCOME.PASS
        elif in_band(actual, refer_band):
            outcome = OUTCOME.REFER
        else:
            outcome = OUTCOME.FAIL
        sign = "≥" if actual >= threshold else "<"
        detail = f"{fmt(actual)} {sign} {fmt(threshold)}"

    elif op == "within_segment_ticket":
        min_ticket = segment.get("min_ticket", 0)
        max_ticket = segment.get("max_ticket", 0)
        threshold = {"min": min_ticket, "max": max_ticket}
        outcome = OUTCOME.PASS if min_ticket <= actual <= max_ticket else OUTCOME.FAIL
        detail = f"{fmt(actual)} within {fmt(min_ticket)}–{fmt(max_ticket)}"

    elif op == "within_segment_tenure":
        t_min = segment.get("tenure_months", {}).get("min", 0)
        t_max = segment.get("tenure_months", {}).get("max", 0)
        threshold = {"min": t_min, "max": t_max}
        outcome = OUTCOME.PASS if t_min <= actual <= t_max else OUTCOME.FAIL
        detail = f"{actual}m within {t_min}–{t_max}m"

    else:
        raise ValueError(f"Unsupported policy operator: {op}")

    if outcome == OUTCOME.PASS:
        reason = rule.get("pass_reason")
    elif outcome == OUTCOME.REFER:
        reason = rule.get("refer_reason")
    else:
        reason = rule.get("reject_reason") or rule.get("refer_reason")

    return {
        **shell,
        "outcome": outcome,
        "actual": actual,
        "threshold": threshold,
        "reason": reason,
        "detail": detail,
    }


def evaluate_policy(args: Dict[str, Any]) -> Dict[str, Any]:
    """Run the full policy against credit metrics and reconciliation state."""
    metrics = args.get("metrics", {})
    reconciliation = args.get("reconciliation") or {}
    unresolved_low_confidence = args.get("unresolvedLowConfidence", 0)
    loan_request = args.get("loanRequest", {})
    policy = args.get("policy", {})

    segment_code = loan_request.get("segment")
    segment = policy.get("segments", {}).get(segment_code)
    if not segment:
        raise ValueError(f"Unknown asset segment: {segment_code}")

    bag = {
        **metrics,
        "blocking_finding_count": reconciliation.get("blocking", 0),
        "advisory_finding_count": reconciliation.get("advisory", 0),
        "unresolved_low_confidence_count": unresolved_low_confidence,
    }

    results = [evaluate_rule(rule, {"metrics": bag, "segment": segment}) for rule in policy.get("rules", [])]

    hard_fails = [
        r
        for r in results
        if r["outcome"] == OUTCOME.FAIL
        and r["severity"] == "BLOCKING"
        and r.get("reason")
        and r["reason"].startswith("R")
    ]
    advisory_fails = [
        r for r in results if r["outcome"] == OUTCOME.FAIL and r["severity"] == "ADVISORY"
    ]
    refers = [r for r in results if r["outcome"] == OUTCOME.REFER]

    reason_codes = []

    if hard_fails:
        decision = DECISIONS.REJECT
        for r in hard_fails:
            if r.get("reason"):
                reason_codes.append(r["reason"])
        for r in refers:
            if r.get("reason"):
                reason_codes.append(r["reason"])
    elif refers or advisory_fails or unresolved_low_confidence > 0:
        decision = DECISIONS.REFER
        for r in refers:
            if r.get("reason"):
                reason_codes.append(r["reason"])
        for r in advisory_fails:
            if r.get("reason"):
                reason_codes.append(r["reason"])
        if unresolved_low_confidence > 0 and "F01" not in reason_codes:
            reason_codes.append("F01")
    else:
        decision = DECISIONS.APPROVE
        for r in results:
            if r["outcome"] == OUTCOME.PASS and r.get("reason"):
                reason_codes.append(r["reason"])

    unique_codes = sorted(set(reason_codes))
    policy_reason_defs = policy.get("reason_codes", {})

    return {
        "decision": decision,
        "reason_codes": [
            {"code": code, "text": policy_reason_defs.get(code, code)}
            for code in unique_codes
        ],
        "rules": results,
        "summary": {
            "passed": sum(1 for r in results if r["outcome"] == OUTCOME.PASS),
            "referred": len(refers),
            "failed": sum(1 for r in results if r["outcome"] == OUTCOME.FAIL),
            "not_applicable": sum(1 for r in results if r["outcome"] == OUTCOME.NOT_APPLICABLE),
            "total": len(results),
        },
        "policy_version": policy.get("version"),
        "policy_id": policy.get("policy_id"),
        "policy_effective_date": policy.get("effective_date"),
        "policy_hash": short_hash(policy),
        "evaluated_hash": hash_value({"bag": bag, "version": policy.get("version")}),
    }


def decisive_rules(evaluation: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Rules the UI should foreground for a given decision."""
    if evaluation.get("decision") == DECISIONS.APPROVE:
        return [r for r in evaluation.get("rules", []) if r["outcome"] == OUTCOME.PASS]
    return [
        r
        for r in evaluation.get("rules", [])
        if r["outcome"] in (OUTCOME.FAIL, OUTCOME.REFER)
    ]
