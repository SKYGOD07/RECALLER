"""RECALLER — narration and credit memo generation."""

from datetime import datetime
import inspect
import re
from typing import Any, Callable, Dict, List, Optional
from ..core.constants import DECISIONS, FINDING_STATUS
from ..core.money import format_inr, format_pct

VERDICT_LEAD = {
    DECISIONS.APPROVE: "The application meets policy on every binding rule and is recommended for sanction.",
    DECISIONS.REFER: "The application cannot be auto-sanctioned and is referred for officer judgement.",
    DECISIONS.REJECT: "The application breaches a binding credit rule and is declined.",
}


def method_label(method: str) -> str:
    if method == "LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET":
        return "lower-of-bank-run-rate-and-platform-net"
    return str(method).lower().replace("_", " ")


def income_narrative(credit: Dict[str, Any]) -> str:
    b = credit.get("income_breakdown", {})
    comp = b.get("components", {})
    parts = []
    parts.append(
        f"Income is recognised on the {method_label(b.get('method', ''))} basis over a {b.get('window_months', 6)}-month window; "
        f"{b.get('months_observed', 0)} month{'s' if b.get('months_observed') != 1 else ''} of statement history was available."
    )
    parts.append(
        f"Mean monthly qualifying credits were {format_inr(comp.get('mean_monthly_credits', 0), decimals=2)}, "
        f"of which {format_inr(comp.get('mean_monthly_cash', 0), decimals=2)} arrived as cash deposits. "
        f"Cash was discounted {format_pct(comp.get('cash_haircut', 0), 0)} and then capped as a share of recognised income, "
        f"admitting {format_inr(comp.get('cash_admitted', 0), decimals=2)}."
    )
    if b.get("platform_view") is not None:
        parts.append(
            f"Platform settlements averaged {format_inr(comp.get('mean_platform_settlement', 0), decimals=2)} per month; "
            f"after a {format_pct(comp.get('platform_haircut', 0), 0)} haircut for churn the platform view is {format_inr(b.get('platform_view', 0), decimals=2)}. "
            f"The bank view is {format_inr(b.get('bank_view', 0), decimals=2)}, and the lower of the two is taken."
        )
    else:
        parts.append("No platform earnings statement was supplied, so the bank view stands alone.")

    parts.append(
        f"Recognised income is {format_inr(b.get('verified_monthly_income', 0), decimals=2)} per month, "
        f"with month-on-month dispersion of {format_pct(b.get('volatility', 0))}."
    )
    return " ".join(parts)


def reconciliation_narrative(rec: Dict[str, Any]) -> str:
    blocking = rec.get("blocking", 0)
    advisory = rec.get("advisory", 0)
    total = rec.get("total", 0)
    if blocking == 0 and advisory == 0:
        return f"All {total} cross-document checks agree within policy tolerance."
    bits = []
    if blocking:
        bits.append(f"{blocking} blocking contradiction{'s' if blocking != 1 else ''}")
    if advisory:
        bits.append(f"{advisory} advisory discrepanc{'ies' if advisory != 1 else 'y'}")
    return (
        f"Of {total} cross-document checks, {' and '.join(bits)} were raised. "
        f"Blocking items must be cleared before sanction; advisory items require officer judgement."
    )


def finding_detail(f: Dict[str, Any]) -> str:
    comp = f.get("comparison", {})
    left = comp.get("left", {})
    right = comp.get("right", {})
    status = f.get("status")
    sim = f.get("similarity")

    if status == FINDING_STATUS.MATCHED:
        sim_str = f" (similarity {format_pct(sim)})" if sim is not None else ""
        return f"{left.get('field')} and {right.get('field')} agree{sim_str}."

    if sim is not None:
        tol_score = f.get("tolerance", {}).get("advisory_score", 0)
        return (
            f'"{left.get("value")}" ({left.get("source")}) against "{right.get("value")}" ({right.get("source")}) — '
            f"similarity {format_pct(sim)}, floor {format_pct(tol_score)}."
        )

    delta = f.get("delta", 0)
    delta_pct = f.get("delta_pct", 0)
    return (
        f"{format_inr(left.get('value'))} ({left.get('source')}) against {format_inr(right.get('value'))} ({right.get('source')}) — "
        f"a gap of {format_inr(delta)}, {format_pct(delta_pct)} of the larger figure."
    )


def display_value(f: Dict[str, Any]) -> str:
    val = f.get("value")
    if val is None:
        return "—"
    if isinstance(val, list):
        return f"{len(val)} values"
    if f.get("type") == "money":
        return format_inr(val, decimals=2)
    if isinstance(val, dict):
        return f"{len(val)} entries"
    return str(val)


def decision_headline(record: Dict[str, Any]) -> str:
    """One-line decision rationale for the dashboard."""
    decision = record.get("decision", {})
    dec_val = decision.get("decision")
    credit = record.get("credit", {})
    m = credit.get("metrics", {})

    if dec_val == DECISIONS.APPROVE:
        return (
            f"Affordability holds at {format_pct(m.get('foir', 0))} FOIR against a {format_pct(0.5)} ceiling, "
            f"with {format_inr(m.get('disposable_income', 0))} residual income after the instalment."
        )

    rcs = decision.get("reason_codes", [])
    drivers = [c.get("text") for c in rcs if str(c.get("code", "")).startswith("R")]
    if drivers:
        return "; ".join(drivers) + "."
    refers = [c.get("text") for c in rcs if str(c.get("code", "")).startswith("F")]
    if refers:
        return "; ".join(refers) + "."
    return "Referred for officer judgement."


def build_credit_memo(record: Dict[str, Any]) -> Dict[str, Any]:
    """Build the structured credit memo dictionary."""
    app = record.get("application", {})
    evidence = record.get("evidence", {})
    reconciliation = record.get("reconciliation", {})
    credit = record.get("credit", {})
    pol_eval = record.get("policyEvaluation", {})
    decision = record.get("decision", {})
    audit = record.get("audit", {})

    m = credit.get("metrics", {})
    inp = credit.get("inputs", {})
    v = evidence.get("values", {})
    applicant = v.get("applicant", {})
    invoice = v.get("invoice", {})

    sections = []

    # Recommendation
    dec_type = decision.get("decision", DECISIONS.REFER)
    if dec_type == DECISIONS.APPROVE:
        rec_tail = (
            f"Sanction {format_inr(m.get('loan_amount'))} over {m.get('tenure_months')} months at "
            f"{inp.get('rate_annual_pct')}% p.a., repayable at {format_inr(m.get('emi'), decimals=2)} per month."
        )
    elif dec_type == DECISIONS.REFER:
        rec_tail = "The items below must be settled by an officer before the file can move."
    else:
        rec_tail = "The breaches below are not waivable at branch level."

    sections.append(
        {
            "id": "summary",
            "title": "Recommendation",
            "kind": "verdict",
            "body": f"{VERDICT_LEAD.get(dec_type, '')} {rec_tail}",
        }
    )

    # Borrower and facility
    sections.append(
        {
            "id": "borrower",
            "title": "Borrower and facility",
            "kind": "table",
            "rows": [
                ["Applicant", applicant.get("name") or "—"],
                ["Age", f"{applicant['age']} years" if applicant.get("age") is not None else "—"],
                ["KYC reference", applicant.get("id_number") or "—"],
                ["PAN", applicant.get("pan") or "—"],
                ["Asset", f"{invoice.get('model') or '—'} ({app.get('segment_label', app.get('segment', '—'))})"],
                ["Dealer", invoice.get("dealer_name") or "—"],
                ["On-road price", format_inr(inp.get("invoice_on_road_price")) if m.get("loan_amount") else "—"],
                ["Requested facility", format_inr(m.get("loan_amount"))],
                ["Tenure", f"{m.get('tenure_months')} months"],
                ["Rate", f"{inp.get('rate_annual_pct')}% p.a. reducing"],
            ],
        }
    )

    # Income assessment
    sections.append(
        {
            "id": "income",
            "title": "Income assessment",
            "kind": "prose",
            "body": income_narrative(credit),
        }
    )

    # Credit metrics
    sections.append(
        {
            "id": "metrics",
            "title": "Credit metrics",
            "kind": "metrics",
            "note": "Computed by the RECALLER calculation engine from gated evidence. No language model contributed to these figures.",
            "rows": [
                ["Verified monthly income", format_inr(m.get("verified_monthly_income"), decimals=2)],
                ["Existing obligations", format_inr(m.get("obligations"), decimals=2)],
                ["Proposed EMI", format_inr(m.get("emi"), decimals=2)],
                ["FOIR", format_pct(m.get("foir"))],
                ["LTV", format_pct(m.get("ltv"))],
                ["Residual income after EMI", format_inr(m.get("disposable_income"), decimals=2)],
                ["Total interest over term", format_inr(m.get("total_interest"), decimals=2)],
            ],
        }
    )

    # Reconciliation
    sections.append(
        {
            "id": "reconciliation",
            "title": "Cross-document reconciliation",
            "kind": "findings",
            "body": reconciliation_narrative(reconciliation),
            "items": [
                {
                    "code": f.get("code"),
                    "label": f.get("label"),
                    "status": f.get("status"),
                    "detail": finding_detail(f),
                }
                for f in reconciliation.get("findings", [])
            ],
        }
    )

    # Policy evaluation
    summary = pol_eval.get("summary", {})
    sections.append(
        {
            "id": "policy",
            "title": "Policy evaluation",
            "kind": "policy",
            "body": (
                f"Evaluated against policy {pol_eval.get('policy_id')} v{pol_eval.get('policy_version')} "
                f"(effective {pol_eval.get('policy_effective_date')}, hash {pol_eval.get('policy_hash')}). "
                f"{summary.get('passed', 0)} of {summary.get('total', 0)} rules passed, "
                f"{summary.get('referred', 0)} referred, {summary.get('failed', 0)} failed."
            ),
            "items": [
                {
                    "code": r.get("code"),
                    "label": r.get("label"),
                    "outcome": r.get("outcome"),
                    "detail": r.get("detail"),
                }
                for r in pol_eval.get("rules", [])
                if r.get("outcome") != "NOT_APPLICABLE"
            ],
        }
    )

    # Reason codes
    sections.append(
        {
            "id": "reasons",
            "title": "Reason codes",
            "kind": "codes",
            "items": decision.get("reason_codes", []),
        }
    )

    # Officer interventions
    interventions = [
        f for f in evidence.get("fields", {}).values() if f.get("provenance") == "OFFICER"
    ]
    interv_body = (
        f"{len(interventions)} field{' was' if len(interventions) == 1 else 's were'} confirmed or amended by a human before decisioning."
        if interventions
        else "No officer intervention was required; every field cleared the confidence gate automatically."
    )
    sections.append(
        {
            "id": "interventions",
            "title": "Officer interventions",
            "kind": "interventions",
            "body": interv_body,
            "items": [
                {
                    "path": f.get("path"),
                    "label": f.get("label"),
                    "action": f.get("officer", {}).get("action"),
                    "from": f.get("superseded", {}).get("value"),
                    "to": f.get("value"),
                    "original_confidence": f.get("superseded", {}).get("confidence"),
                    "by": f.get("officer", {}).get("by"),
                    "at": f.get("officer", {}).get("at"),
                    "note": f.get("officer", {}).get("note"),
                }
                for f in interventions
            ],
        }
    )

    # Evidence citations
    sections.append(
        {
            "id": "evidence",
            "title": "Evidence citations",
            "kind": "citations",
            "items": [
                {
                    "label": f.get("label"),
                    "value": display_value(f),
                    "confidence": f.get("confidence"),
                    "provenance": f.get("provenance"),
                    "document": f.get("citation", {}).get("document"),
                    "page": f.get("citation", {}).get("page"),
                }
                for f in evidence.get("fields", {}).values()
                if f.get("citation")
            ],
        }
    )

    # Provenance
    now_gen = record.get("generated_at") or datetime.utcnow().isoformat() + "Z"
    sections.append(
        {
            "id": "provenance",
            "title": "Provenance",
            "kind": "table",
            "rows": [
                ["Application ID", app.get("id")],
                ["Trace ID", audit.get("traceId", "")],
                ["Ledger head", audit.get("head", "")],
                ["Engine version", credit.get("engine_version", "")],
                ["Policy version", f"{pol_eval.get('policy_id')} v{pol_eval.get('policy_version')}"],
                ["Policy hash", pol_eval.get("policy_hash", "")],
                ["Calculation input hash", credit.get("input_hash", "")],
                ["Extraction hash", evidence.get("extraction_hash", "")],
                ["Extraction adapter", evidence.get("stats", {}).get("adapter", "")],
                ["Workflow execution", record.get("execution", {}).get("n8n_execution_id") or "local"],
                ["Workflow version", record.get("execution", {}).get("workflow_version") or "—"],
                ["Generated at", now_gen],
            ],
        }
    )

    borrower_name = applicant.get("name") or app.get("borrower_name", "")
    return {
        "application_id": app.get("id"),
        "decision": decision.get("decision"),
        "generated_at": now_gen,
        "title": f"Credit memorandum — {borrower_name} — {app.get('id')}",
        "sections": sections,
    }


def numeric_tokens(text: str) -> str:
    matches = re.findall(r"[\d.,]+", str(text))
    return "|".join(matches)


async def narrate(
    memo: Dict[str, Any], stylist: Optional[Callable[..., Any]] = None
) -> Dict[str, Any]:
    """Optional LLM pass. Discards rewrite if any numeric token moves."""
    if not stylist:
        return memo

    sections = []
    for s in memo.get("sections", []):
        if s.get("kind") != "prose" or not s.get("body"):
            sections.append(s)
            continue
        try:
            res = stylist(s["body"])
            if inspect.isawaitable(res):
                res = await res
            rewritten = str(res or "").strip()
            if numeric_tokens(rewritten) == numeric_tokens(s["body"]):
                sections.append({**s, "body": rewritten, "styled": True})
            else:
                sections.append(s)
        except Exception:
            sections.append(s)

    return {**memo, "sections": sections}

