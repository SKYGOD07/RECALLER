"""RECALLER — underwriting orchestrator.

Sequences the stages of a file and records every one of them in the audit ledger.
The pipeline is fully resumable and deterministic.
"""

import asyncio
from datetime import datetime, timezone
import inspect
import time
from typing import Any, Callable, Dict, List, Optional
from ..core.audit import ACTORS, append_event, create_ledger
from ..core.constants import (
    APP_STATUS,
    DECISIONS,
    ENGINE_VERSION,
    WORKFLOW_VERSION,
)
from ..core.hash import hash_value, make_id
from ..core.money import round_half_up
from ..credit_engine.engine import compute_credit_metrics
from ..extraction.adapters import (
    apply_confidence_gate,
    apply_officer_resolutions,
    extract_bundle,
    fixture_adapter,
    materialise,
)
from ..narration.memo import build_credit_memo, decision_headline
from ..policy_engine.engine import evaluate_policy
from ..reconciliation.reconcile import reconcile, summarise
from ..whatif.solver import simulate, solve_minimum_change

STAGE_PLAN = [
    {"id": "INGEST", "label": "Document ingestion", "stage": "DOCUMENT_INGESTED", "actor": ACTORS.SYSTEM},
    {"id": "KYC", "label": "KYC extraction", "stage": "KYC_EXTRACTION", "actor": ACTORS.LLM},
    {"id": "BANK", "label": "Bank statement extraction", "stage": "BANK_EXTRACTION", "actor": ACTORS.LLM},
    {"id": "PLATFORM", "label": "Platform earnings extraction", "stage": "PLATFORM_EXTRACTION", "actor": ACTORS.LLM},
    {"id": "INVOICE", "label": "Invoice extraction", "stage": "INVOICE_EXTRACTION", "actor": ACTORS.LLM},
    {"id": "VALIDATE", "label": "Evidence validation", "stage": "EVIDENCE_VALIDATION", "actor": ACTORS.ENGINE},
    {"id": "RECONCILE", "label": "Reconciliation", "stage": "RECONCILIATION", "actor": ACTORS.ENGINE},
    {"id": "GATE", "label": "Confidence gate", "stage": "CONFIDENCE_GATE", "actor": ACTORS.ENGINE},
    {"id": "CREDIT", "label": "Credit analysis", "stage": "CREDIT_CALCULATION", "actor": ACTORS.ENGINE},
    {"id": "POLICY", "label": "Policy evaluation", "stage": "POLICY_EVALUATION", "actor": ACTORS.ENGINE},
    {"id": "DECISION", "label": "Decision", "stage": "DECISION", "actor": ACTORS.ENGINE},
    {"id": "MEMO", "label": "Credit memo", "stage": "MEMO_GENERATED", "actor": ACTORS.ENGINE},
]

DECISION_TO_STATUS = {
    DECISIONS.APPROVE: APP_STATUS.APPROVED,
    DECISIONS.REFER: APP_STATUS.REFERRED,
    DECISIONS.REJECT: APP_STATUS.REJECTED,
}


def make_clock(now: Optional[str] = None) -> Callable[[], str]:
    if not now:
        return lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        t_dt = datetime.fromisoformat(now.replace("Z", "+00:00"))
        t_sec = t_dt.timestamp()
    except Exception:
        t_sec = time.time()

    def get_time() -> str:
        nonlocal t_sec
        iso = datetime.fromtimestamp(t_sec, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        t_sec += 1.0
        return iso

    return get_time


def strip_payload(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in doc.items() if k not in ("payload", "degrade")}


def round4(n: Any) -> float:
    try:
        return round_half_up(float(n), 4)
    except Exception:
        return 0.0


async def maybe_await(res: Any) -> Any:
    if inspect.isawaitable(res):
        return await res
    return res


def create_stage_runner(box: Dict[str, Any], clock: Callable[[], str], on_stage: Optional[Callable[..., Any]]):
    async def tick(plan_id: str, fn: Callable[[], Any]) -> Any:
        plan = next((p for p in STAGE_PLAN if p["id"] == plan_id), None)
        if on_stage:
            await maybe_await(on_stage({"id": plan_id, "status": "RUNNING"}))

        started_ms = time.time()
        out = fn()
        if inspect.isawaitable(out):
            out = await out

        duration_ms = int(round((time.time() - started_ms) * 1000.0))

        summary = out.get("summary") if isinstance(out, dict) else (plan["label"] if plan else plan_id)
        detail = out.get("detail", {}) if isinstance(out, dict) else {}
        val = out.get("value") if isinstance(out, dict) else out

        box["ledger"] = append_event(
            box["ledger"],
            {
                "stage": plan["stage"] if plan else plan_id,
                "actor": plan["actor"] if plan else ACTORS.SYSTEM,
                "summary": summary,
                "detail": detail,
                "durationMs": duration_ms,
                "at": clock(),
            },
        )

        if on_stage:
            await maybe_await(on_stage({"id": plan_id, "status": "DONE", "ms": duration_ms}))

        return val

    return tick


async def run_underwriting(
    application: Dict[str, Any],
    documents: List[Dict[str, Any]],
    policy: Dict[str, Any],
    adapter: Any = fixture_adapter,
    resolutions: Optional[List[Dict[str, Any]]] = None,
    on_stage: Optional[Callable[..., Any]] = None,
    now: Optional[str] = None,
    execution: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Execute the full underwriting pipeline."""
    res_list = resolutions or []
    clock = make_clock(now)
    doc_ids = [d.get("id") for d in documents]
    trace_id = make_id("TRC", [application.get("id"), policy.get("version"), doc_ids])
    box = {"ledger": create_ledger(trace_id)}
    tick = create_stage_runner(box, clock, on_stage)

    box["ledger"] = append_event(
        box["ledger"],
        {
            "stage": "APPLICATION_CREATED",
            "actor": ACTORS.OFFICER,
            "summary": f"Application created for {application.get('borrower_name')}",
            "detail": {
                "segment": application.get("segment"),
                "amount": application.get("loan_amount"),
                "tenure": application.get("tenure_months"),
            },
            "at": clock(),
        },
    )

    # Ingestion
    await tick(
        "INGEST",
        lambda: {
            "summary": f"{len(documents)} documents ingested",
            "detail": {
                "documents": [
                    {
                        "id": d.get("id"),
                        "type": d.get("type"),
                        "filename": d.get("filename"),
                        "pages": d.get("pages"),
                    }
                    for d in documents
                ]
            },
            "value": None,
        },
    )

    # Extraction
    extraction = await extract_bundle(
        documents=documents,
        application=application,
        adapter=adapter,
        seed=application.get("id"),
    )

    groups = [
        ("KYC", ["AADHAAR", "PAN", "DRIVING_LICENCE"]),
        ("BANK", ["BANK_STATEMENT"]),
        ("PLATFORM", ["PLATFORM_EARNINGS"]),
        ("INVOICE", ["DEALER_INVOICE"]),
    ]

    for plan_id, types in groups:
        docs = [d for d in documents if d.get("type") in types]
        paths = []
        for d in docs:
            paths.extend(extraction.get("byDocument", {}).get(d.get("id"), []))

        doc_count_str = f"{len(docs)} document{'s' if len(docs) != 1 else ''}"
        sum_text = (
            f"{len(paths)} fields extracted from {doc_count_str}"
            if docs
            else "No document of this type supplied"
        )
        await tick(
            plan_id,
            lambda s=sum_text, ds=docs, ps=paths: {
                "summary": s,
                "detail": {"documents": [d.get("filename") for d in ds], "fields": ps},
                "value": None,
            },
        )

    # Validate
    fields = apply_officer_resolutions(extraction["fields"], res_list)
    stats = extraction.get("stats", {})
    await tick(
        "VALIDATE",
        lambda: {
            "summary": f"{len(fields)} evidence fields validated",
            "detail": {
                "mean_confidence": round4(stats.get("mean_confidence")),
                "min_confidence": round4(stats.get("min_confidence")),
                "adapter": stats.get("adapter"),
                "officer_supplied": len(res_list),
            },
            "value": None,
        },
    )

    # Provisional metrics & Reconciliation
    values = materialise(fields)
    loan_request = {
        "amount": application.get("loan_amount"),
        "tenureMonths": application.get("tenure_months"),
        "segment": application.get("segment"),
    }

    try:
        provisional = compute_credit_metrics(
            evidence=values, loan_request=loan_request, policy=policy
        )
    except Exception:
        provisional = None

    def run_reconcile():
        if provisional:
            r = reconcile(
                {
                    "evidence": values,
                    "loanRequest": loan_request,
                    "creditMetrics": provisional,
                    "policy": policy,
                }
            )
        else:
            r = summarise([])
        return {
            "summary": f"{r['total']} checks — {r['blocking']} blocking, {r['advisory']} advisory",
            "detail": {
                "blocking": r["blocking"],
                "advisory": r["advisory"],
                "matched": r["matched"],
                "codes": [f"{f['code']}:{f['status']}" for f in r["findings"]],
            },
            "value": r,
        }

    reconciliation = await tick("RECONCILE", run_reconcile)

    # Confidence Gate
    def run_gate():
        g = apply_confidence_gate(fields, policy)
        s = (
            "All fields above confidence floor"
            if g["passed"]
            else f"{len(g['held'])} field{'s' if len(g['held']) != 1 else ''} held for officer verification"
        )
        return {
            "summary": s,
            "detail": {
                "held": [
                    {
                        "path": h["path"],
                        "confidence": round4(h["confidence"]),
                        "floor": h["floor"],
                    }
                    for h in g["held"]
                ],
                "thresholds": g["thresholds"],
            },
            "value": g,
        }

    gate = await tick("GATE", run_gate)

    seg_label = policy.get("segments", {}).get(application.get("segment"), {}).get("label") or application.get("segment")
    base = {
        "application": {**application, "segment_label": seg_label},
        "documents": [strip_payload(d) for d in documents],
        "evidence": {
            "fields": fields,
            "values": values,
            "stats": stats,
            "extraction_hash": extraction.get("extraction_hash"),
            "byDocument": extraction.get("byDocument"),
        },
        "reconciliation": reconciliation,
        "resolutions": res_list,
        "policy_version": policy.get("version"),
        "policy_hash": hash_value(policy)[:12],
        "engine_version": ENGINE_VERSION,
        "execution": execution or {"n8n_execution_id": None, "workflow_version": WORKFLOW_VERSION},
        "stage_plan": STAGE_PLAN,
    }

    if not gate["passed"]:
        box["ledger"] = append_event(
            box["ledger"],
            {
                "stage": "OFFICER_REVIEW",
                "actor": ACTORS.SYSTEM,
                "summary": f"Execution suspended awaiting officer verification of {len(gate['held'])} field{'s' if len(gate['held']) != 1 else ''}",
                "detail": {"fields": [h["path"] for h in gate["held"]]},
                "at": clock(),
            },
        )
        return {
            **base,
            "status": APP_STATUS.WAITING_FOR_OFFICER,
            "assist": {
                "required": True,
                "queue": gate["held"],
                "thresholds": gate["thresholds"],
                "resolved": [],
            },
            "credit": None,
            "policyEvaluation": None,
            "decision": None,
            "memo": None,
            "audit": box["ledger"],
            "checkpoint": {
                "created_at": clock(),
                "completed_stages": [
                    "INGEST",
                    "KYC",
                    "BANK",
                    "PLATFORM",
                    "INVOICE",
                    "VALIDATE",
                    "RECONCILE",
                    "GATE",
                ],
                "fields": fields,
                "extraction_stats": stats,
                "extraction_hash": extraction.get("extraction_hash"),
                "byDocument": extraction.get("byDocument"),
                "reconciliation": reconciliation,
                "ledger": box["ledger"],
                "seed": application.get("id"),
                "hash": hash_value(
                    {
                        "fields": fields,
                        "reconciliation": [f["code"] for f in reconciliation.get("findings", [])],
                    }
                ),
            },
        }

    return await finalise(
        base=base,
        values=values,
        reconciliation=reconciliation,
        loan_request=loan_request,
        policy=policy,
        box=box,
        clock=clock,
        tick=tick,
        gate=gate,
        resolutions=res_list,
    )


async def resume_underwriting(
    record: Dict[str, Any],
    resolutions: List[Dict[str, Any]],
    policy: Dict[str, Any],
    on_stage: Optional[Callable[..., Any]] = None,
    now: Optional[str] = None,
) -> Dict[str, Any]:
    """Resume a suspended execution from its checkpoint."""
    checkpoint = record.get("checkpoint")
    if not checkpoint:
        raise ValueError("Cannot resume: no checkpoint on this record.")

    clock = make_clock(now)
    box = {"ledger": checkpoint.get("ledger")}
    tick = create_stage_runner(box, clock, on_stage)

    all_resolutions = [*(record.get("resolutions") or []), *resolutions]
    fields = apply_officer_resolutions(checkpoint.get("fields", {}), resolutions)

    box["ledger"] = append_event(
        box["ledger"],
        {
            "stage": "OFFICER_REVIEW",
            "actor": ACTORS.OFFICER,
            "summary": f"Officer resolved {len(resolutions)} field{'s' if len(resolutions) != 1 else ''}",
            "detail": {
                "resolutions": [
                    {
                        "path": r.get("path"),
                        "action": r.get("action"),
                        "from": checkpoint.get("fields", {}).get(r.get("path"), {}).get("value"),
                        "to": (
                            r.get("value")
                            if r.get("action") == "EDIT"
                            else checkpoint.get("fields", {}).get(r.get("path"), {}).get("value")
                        ),
                        "note": r.get("note"),
                    }
                    for r in resolutions
                ],
                "resumed_from_checkpoint": checkpoint.get("hash"),
            },
            "at": clock(),
        },
    )

    values = materialise(fields)
    app = record.get("application", {})
    loan_request = {
        "amount": app.get("loan_amount"),
        "tenureMonths": app.get("tenure_months"),
        "segment": app.get("segment"),
    }

    provisional = compute_credit_metrics(
        evidence=values, loan_request=loan_request, policy=policy
    )

    def run_reconcile():
        r = reconcile(
            {
                "evidence": values,
                "loanRequest": loan_request,
                "creditMetrics": provisional,
                "policy": policy,
            }
        )
        return {
            "summary": f"{r['total']} checks re-run after officer input — {r['blocking']} blocking, {r['advisory']} advisory",
            "detail": {"blocking": r["blocking"], "advisory": r["advisory"]},
            "value": r,
        }

    reconciliation = await tick("RECONCILE", run_reconcile)
    gate = {
        "passed": True,
        "held": [],
        "thresholds": record.get("assist", {}).get("thresholds")
        or policy.get("confidence", {}),
    }

    base = {
        **record,
        "evidence": {
            "fields": fields,
            "values": values,
            "stats": checkpoint.get("extraction_stats"),
            "extraction_hash": checkpoint.get("extraction_hash"),
            "byDocument": checkpoint.get("byDocument"),
        },
        "reconciliation": reconciliation,
        "resolutions": all_resolutions,
    }

    return await finalise(
        base=base,
        values=values,
        reconciliation=reconciliation,
        loan_request=loan_request,
        policy=policy,
        box=box,
        clock=clock,
        tick=tick,
        gate=gate,
        resolutions=all_resolutions,
    )


async def finalise(
    base: Dict[str, Any],
    values: Dict[str, Any],
    reconciliation: Dict[str, Any],
    loan_request: Dict[str, Any],
    policy: Dict[str, Any],
    box: Dict[str, Any],
    clock: Callable[[], str],
    tick: Any,
    gate: Dict[str, Any],
    resolutions: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Terminal half of pipeline: credit calculation, policy evaluation, decision, memo."""
    def run_credit():
        c = compute_credit_metrics(
            evidence=values, loan_request=loan_request, policy=policy
        )
        m = c["metrics"]
        return {
            "summary": f"EMI {m['emi']}, FOIR {m['foir']}, LTV {m['ltv']}",
            "detail": {
                "inputs": c["inputs"],
                "metrics": m,
                "input_hash": c["input_hash"],
                "engine_version": c["engine_version"],
            },
            "value": c,
        }

    credit = await tick("CREDIT", run_credit)

    def run_policy():
        p = evaluate_policy(
            {
                "metrics": credit["metrics"],
                "reconciliation": reconciliation,
                "unresolvedLowConfidence": len(gate.get("held", [])),
                "loanRequest": loan_request,
                "policy": policy,
            }
        )
        s = p["summary"]
        return {
            "summary": f"{s['passed']}/{s['total']} rules passed, {s['failed']} failed, {s['referred']} referred",
            "detail": {
                "policy_version": p["policy_version"],
                "policy_hash": p["policy_hash"],
                "rules": [f"{r['code']}:{r['outcome']}" for r in p["rules"]],
            },
            "value": p,
        }

    policy_eval = await tick("POLICY", run_policy)

    dec_val = policy_eval["decision"]
    rcs = policy_eval["reason_codes"]

    def run_decision():
        return {
            "summary": f"{dec_val} — {', '.join(c['code'] for c in rcs)}",
            "detail": {"decision": dec_val, "reason_codes": rcs},
            "value": {"decision": dec_val, "reason_codes": rcs},
        }

    decision = await tick("DECISION", run_decision)

    record = {
        **base,
        "status": DECISION_TO_STATUS.get(dec_val, APP_STATUS.REFERRED),
        "assist": {
            "required": False,
            "queue": [],
            "thresholds": gate.get("thresholds"),
            "resolved": resolutions,
        },
        "credit": credit,
        "policyEvaluation": policy_eval,
        "decision": decision,
        "audit": box["ledger"],
        "generated_at": clock(),
        "checkpoint": None,
    }

    def run_memo():
        m = build_credit_memo(record)
        return {
            "summary": f"Credit memo generated ({len(m['sections'])} sections)",
            "detail": {"sections": [s["id"] for s in m["sections"]]},
            "value": m,
        }

    memo = await tick("MEMO", run_memo)
    return {
        **record,
        "memo": memo,
        "headline": decision_headline(record),
        "audit": box["ledger"],
    }


async def replay(
    record: Dict[str, Any],
    policy: Dict[str, Any],
    label: str = "Replay with original policy",
) -> Dict[str, Any]:
    """Re-execute a completed application from frozen material."""
    fields = record.get("evidence", {}).get("fields", {})
    values = materialise(fields)
    app = record.get("application", {})
    loan_request = {
        "amount": app.get("loan_amount"),
        "tenureMonths": app.get("tenure_months"),
        "segment": app.get("segment"),
    }

    provisional = compute_credit_metrics(
        evidence=values, loan_request=loan_request, policy=policy
    )
    rec = reconcile(
        {
            "evidence": values,
            "loanRequest": loan_request,
            "creditMetrics": provisional,
            "policy": policy,
        }
    )
    credit = compute_credit_metrics(
        evidence=values, loan_request=loan_request, policy=policy
    )
    policy_eval = evaluate_policy(
        {
            "metrics": credit["metrics"],
            "reconciliation": rec,
            "unresolvedLowConfidence": 0,
            "loanRequest": loan_request,
            "policy": policy,
        }
    )

    original_credit = record.get("credit", {})
    original_m = original_credit.get("metrics", {})
    new_m = credit.get("metrics", {})

    identical = (
        credit.get("input_hash") == original_credit.get("input_hash")
        and policy_eval["decision"] == record.get("decision", {}).get("decision")
        and new_m == original_m
    )

    # Diff
    rows = []
    for k in ("emi", "foir", "ltv", "obligations", "verified_monthly_income"):
        if original_m.get(k) != new_m.get(k):
            rows.append({"field": k, "from": original_m.get(k), "to": new_m.get(k)})

    orig_codes = [c.get("code") for c in record.get("decision", {}).get("reason_codes", [])]
    new_codes = [c.get("code") for c in policy_eval.get("reason_codes", [])]

    orig_dec = record.get("decision", {}).get("decision")
    new_dec = policy_eval["decision"]

    diff = {
        "metrics": rows,
        "decision": None if orig_dec == new_dec else {"from": orig_dec, "to": new_dec},
        "reason_codes": {
            "added": [c for c in new_codes if c not in orig_codes],
            "removed": [c for c in orig_codes if c not in new_codes],
        },
    }

    return {
        "label": label,
        "ran_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "used_llm": False,
        "policy_version": policy.get("version"),
        "policy_hash": policy_eval.get("policy_hash"),
        "identical": identical,
        "credit": credit,
        "reconciliation": rec,
        "policyEvaluation": policy_eval,
        "decision": {
            "decision": policy_eval["decision"],
            "reason_codes": policy_eval["reason_codes"],
        },
        "diff": diff,
    }


def with_co_applicant(values: Dict[str, Any], monthly_income: float) -> Dict[str, Any]:
    bank_ev = values.get("bank", {})
    credits = bank_ev.get("monthly_credits") or []
    platform_ev = values.get("platform")

    new_val = {**values}
    new_val["bank"] = {
        **bank_ev,
        "monthly_credits": [c + monthly_income for c in credits],
        "monthly_cash_deposits": bank_ev.get("monthly_cash_deposits") or [],
    }
    if platform_ev:
        p_net = platform_ev.get("monthly_net") or []
        new_val["platform"] = {
            **platform_ev,
            "monthly_net": [c + monthly_income for c in p_net],
        }
    return new_val


def make_scenario_evaluator(
    record: Dict[str, Any], policy: Dict[str, Any]
) -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    values = record.get("evidence", {}).get("values", {})
    segment = record.get("application", {}).get("segment")

    def evaluate_scenario(scenario: Dict[str, Any]) -> Dict[str, Any]:
        loan_request = {
            "amount": scenario.get("amount"),
            "tenureMonths": scenario.get("tenureMonths"),
            "segment": segment,
        }
        co_app_inc = scenario.get("coApplicantIncome", 0)
        ev = with_co_applicant(values, co_app_inc) if co_app_inc else values

        credit = compute_credit_metrics(evidence=ev, loan_request=loan_request, policy=policy)
        rec = reconcile(
            {
                "evidence": ev,
                "loanRequest": loan_request,
                "creditMetrics": credit,
                "policy": policy,
            }
        )
        evaluation = evaluate_policy(
            {
                "metrics": credit["metrics"],
                "reconciliation": rec,
                "unresolvedLowConfidence": 0,
                "loanRequest": loan_request,
                "policy": policy,
            }
        )
        return {
            "decision": evaluation["decision"],
            "metrics": credit["metrics"],
            "evaluation": evaluation,
            "reason_codes": evaluation["reason_codes"],
        }

    return evaluate_scenario


def run_what_if(
    record: Dict[str, Any], policy: Dict[str, Any], target: Optional[str] = None
) -> Dict[str, Any]:
    evaluator = make_scenario_evaluator(record, policy)
    app = record.get("application", {})
    base_scenario = {
        "amount": app.get("loan_amount"),
        "tenureMonths": app.get("tenure_months"),
        "coApplicantIncome": 0,
    }
    kwargs = {"target": target} if target else {}
    return solve_minimum_change(
        evaluate=evaluator,
        base_scenario=base_scenario,
        policy=policy,
        segment=app.get("segment", "EV_2W"),
        **kwargs,
    )


def run_simulation(
    record: Dict[str, Any], policy: Dict[str, Any], scenario: Dict[str, Any]
) -> Dict[str, Any]:
    evaluator = make_scenario_evaluator(record, policy)
    app = record.get("application", {})
    base_scenario = {
        "amount": app.get("loan_amount"),
        "tenureMonths": app.get("tenure_months"),
        "coApplicantIncome": 0,
    }
    return simulate(evaluate=evaluator, base_scenario=base_scenario, scenario=scenario)
