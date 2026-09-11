"""RECALLER — what-if solver.

Answers the question a loan officer asks at the counter: "what is the smallest
change that turns this into a yes?" Re-runs the complete deterministic
pipeline for candidate scenarios to find exact, reproducible levers.
"""

import math
from typing import Any, Callable, Dict, List, Optional
from ..core.constants import DECISIONS
from ..core.money import round_half_up

RANK = {
    DECISIONS.REJECT: 0,
    DECISIONS.REFER: 1,
    DECISIONS.APPROVE: 2,
}


def is_better(candidate: str, base: str) -> bool:
    return RANK.get(candidate, 0) > RANK.get(base, 0)


def meets(result: Dict[str, Any], target: str) -> bool:
    dec = result.get("decision", "")
    return RANK.get(dec, 0) >= RANK.get(target, 0)


def lever(
    lever_id: str,
    label: str,
    feasible: bool,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    extra_dict = extra or {}
    disruption = extra_dict.get("disruption", 1.0) if feasible else float("inf")
    return {
        "id": lever_id,
        "label": label,
        "feasible": feasible,
        "disruption": disruption,
        **extra_dict,
    }


def solve_amount(
    evaluate: Callable[[Dict[str, Any]], Dict[str, Any]],
    base_scenario: Dict[str, Any],
    seg: Dict[str, Any],
    target: str,
) -> Dict[str, Any]:
    original = base_scenario.get("amount", 0)
    step = 500
    lo = seg.get("min_ticket", 0)
    hi = original

    def at(amt: int) -> Dict[str, Any]:
        return evaluate({**base_scenario, "amount": amt})

    if not meets(at(lo), target):
        return lever(
            "LOAN_AMOUNT",
            "Reduce loan amount",
            False,
            {
                "note": f"Even at the product floor of ₹{lo:,} this file does not reach {target}."
            },
        )

    lo = math.ceil(lo / step) * step
    hi = math.floor(hi / step) * step
    best = lo
    while lo <= hi:
        mid = math.floor((lo + hi) / 2 / step) * step
        if meets(at(mid), target):
            best = mid
            lo = mid + step
        else:
            hi = mid - step

    result = at(best)
    delta = round_half_up(original - best, 2)
    return lever(
        "LOAN_AMOUNT",
        "Reduce loan amount",
        True,
        {
            "from": original,
            "to": best,
            "delta": delta,
            "delta_pct": round_half_up(delta / original, 4) if original else 0.0,
            "unit": "money",
            "change_text": f"Reduce the sanctioned amount by ₹{int(delta):,} to ₹{int(best):,}",
            "scenario": {**base_scenario, "amount": best},
            "result": result,
            "disruption": delta / original if original else 0.0,
        },
    )


def solve_tenure(
    evaluate: Callable[[Dict[str, Any]], Dict[str, Any]],
    base_scenario: Dict[str, Any],
    seg: Dict[str, Any],
    target: str,
) -> Dict[str, Any]:
    original = int(base_scenario.get("tenureMonths", 0))
    max_tenure = seg.get("tenure_months", {}).get("max", 60)

    for t in range(original + 1, max_tenure + 1):
        scenario = {**base_scenario, "tenureMonths": t}
        result = evaluate(scenario)
        if meets(result, target):
            delta = t - original
            m = result.get("metrics", {})
            return lever(
                "TENURE",
                "Extend tenure",
                True,
                {
                    "from": original,
                    "to": t,
                    "delta": delta,
                    "unit": "months",
                    "change_text": f"Extend the tenure by {delta} month{'s' if delta != 1 else ''} to {t} months",
                    "scenario": scenario,
                    "result": result,
                    "disruption": delta / max_tenure,
                    "note": f"Total interest rises to ₹{int(m.get('total_interest', 0)):,}.",
                },
            )

    return lever(
        "TENURE",
        "Extend tenure",
        False,
        {
            "note": f"No tenure up to the product maximum of {max_tenure} months reaches {target}."
        },
    )


def solve_co_applicant(
    evaluate: Callable[[Dict[str, Any]], Dict[str, Any]],
    base_scenario: Dict[str, Any],
    target: str,
) -> Dict[str, Any]:
    step = 500
    cap = 200000

    def at(inc: int) -> Dict[str, Any]:
        return evaluate({**base_scenario, "coApplicantIncome": inc})

    if not meets(at(cap), target):
        return lever(
            "CO_APPLICANT",
            "Add a co-applicant",
            False,
            {
                "note": "Additional income alone does not clear this file — the blocker is not affordability."
            },
        )

    lo = 0
    hi = cap
    best = cap
    while lo <= hi:
        mid = int(round_half_up((lo + hi) / 2 / step, 0)) * step
        if meets(at(mid), target):
            best = mid
            hi = mid - step
        else:
            lo = mid + step
        if hi < lo:
            break

    scenario = {**base_scenario, "coApplicantIncome": best}
    from_inc = base_scenario.get("coApplicantIncome") or 0
    delta = best - from_inc

    return lever(
        "CO_APPLICANT",
        "Add a co-applicant",
        True,
        {
            "from": from_inc,
            "to": best,
            "delta": delta,
            "unit": "money",
            "change_text": f"Add a co-applicant with at least ₹{int(best):,} verified monthly income",
            "scenario": scenario,
            "result": at(best),
            "disruption": 0.5 + best / cap,
            "note": "Co-applicant income must itself be evidenced and reconciled before sanction.",
        },
    )


def solve_minimum_change(
    evaluate: Callable[[Dict[str, Any]], Dict[str, Any]],
    base_scenario: Dict[str, Any],
    policy: Dict[str, Any],
    segment: str,
    target: str = DECISIONS.APPROVE,
) -> Dict[str, Any]:
    """Solve for the smallest lever movement turning a file into target verdict."""
    seg = policy.get("segments", {}).get(segment, {})
    base = evaluate(base_scenario)
    levers = []

    if RANK.get(base.get("decision", ""), 0) >= RANK.get(target, 0):
        return {
            "base": base,
            "already_meets_target": True,
            "target": target,
            "levers": [],
            "recommended": None,
        }

    levers.append(solve_amount(evaluate, base_scenario, seg, target))
    levers.append(solve_tenure(evaluate, base_scenario, seg, target))
    levers.append(solve_co_applicant(evaluate, base_scenario, target))

    feasible = [l for l in levers if l.get("feasible")]
    feasible.sort(key=lambda l: l.get("disruption", float("inf")))

    return {
        "base": base,
        "already_meets_target": False,
        "target": target,
        "levers": levers,
        "recommended": feasible[0] if feasible else None,
    }


def simulate(
    evaluate: Callable[[Dict[str, Any]], Dict[str, Any]],
    base_scenario: Dict[str, Any],
    scenario: Dict[str, Any],
) -> Dict[str, Any]:
    """Free-form sandbox simulation comparing alternative against base."""
    base = evaluate(base_scenario)
    next_res = evaluate({**base_scenario, **scenario})

    b_dec = base.get("decision", "")
    n_dec = next_res.get("decision", "")

    changed = (
        "IMPROVED"
        if is_better(n_dec, b_dec)
        else ("WORSENED" if is_better(b_dec, n_dec) else "UNCHANGED")
    )

    b_m = base.get("metrics", {})
    n_m = next_res.get("metrics", {})

    return {
        "base": base,
        "next": next_res,
        "changed": changed,
        "deltas": {
            "emi": round_half_up(n_m.get("emi", 0) - b_m.get("emi", 0), 2),
            "foir": round_half_up((n_m.get("foir") or 0) - (b_m.get("foir") or 0), 4),
            "ltv": round_half_up((n_m.get("ltv") or 0) - (b_m.get("ltv") or 0), 4),
            "total_interest": round_half_up(
                n_m.get("total_interest", 0) - b_m.get("total_interest", 0), 2
            ),
        },
    }
