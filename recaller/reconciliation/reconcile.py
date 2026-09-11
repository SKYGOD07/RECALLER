"""RECALLER — cross-document reconciliation.

Extraction tells us what each document says. Reconciliation asks whether the
documents agree with each other, and grades every disagreement against
policy-configured tolerances.
"""

import re
from typing import Any, Dict, List, Optional, Set, Tuple
from ..core.constants import FINDING_STATUS
from ..core.money import round_half_up


def normalise(s: Any) -> str:
    """Normalise name or address strings for robust comparison."""
    if s is None:
        return ""
    st = str(s).upper()
    # Strip honorifics, relations, non-alphanumerics, collapse whitespace
    st = re.sub(r"\b(MR|MRS|MS|SHRI|SMT|DR|SON OF|S/O|D/O|W/O)\b", " ", st)
    st = re.sub(r"[^A-Z0-9 ]", " ", st)
    st = re.sub(r"\s+", " ", st)
    return st.strip()


def levenshtein(a: str, b: str) -> int:
    """Levenshtein distance, iterative two-row form."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
        prev = cur
    return prev[len(b)]


def name_similarity(a: Any, b: Any) -> float:
    """Name similarity tolerating reordered tokens, initials, and spelling variants.

    Returns 0.0 .. 1.0 (4 decimal places).
    """
    A = normalise(a)
    B = normalise(b)
    if not A or not B:
        return 0.0
    if A == B:
        return 1.0

    ta = [t for t in A.split(" ") if t]
    tb = [t for t in B.split(" ") if t]
    short_tokens, long_tokens = (ta, tb) if len(ta) <= len(tb) else (tb, ta)

    used_indices: Set[int] = set()
    score = 0.0

    for token in short_tokens:
        best = 0.0
        best_idx = -1
        for idx, other in enumerate(long_tokens):
            if idx in used_indices:
                continue
            if token == other:
                s = 1.0
            elif len(token) == 1 or len(other) == 1:
                s = 0.8 if token[0] == other[0] else 0.0
            else:
                d = levenshtein(token, other)
                s = 1.0 - d / max(len(token), len(other))

            if s > best:
                best = s
                best_idx = idx

        if best_idx >= 0 and best > 0.5:
            used_indices.add(best_idx)
        score += best

    coverage = score / len(short_tokens) if short_tokens else 0.0
    length_penalty = 1.0 - (len(long_tokens) - len(short_tokens)) * 0.06
    val = max(0.0, min(1.0, coverage * length_penalty))
    return round_half_up(val, 4)


def address_similarity(a: Any, b: Any) -> float:
    """Address agreement scored by containment rather than symmetric overlap."""
    A = set(t for t in normalise(a).split(" ") if len(t) > 2)
    B = set(t for t in normalise(b).split(" ") if len(t) > 2)
    if not A or not B:
        return 0.0
    hit = sum(1 for t in A if t in B)
    val = hit / min(len(A), len(B))
    return round_half_up(val, 4)


def pct_finding(args: Dict[str, Any]) -> Dict[str, Any]:
    code = args["code"]
    label = args["label"]
    left = args["left"]
    right = args["right"]
    tolerance = args["tolerance"]
    evidence = args["evidence"]
    note = args.get("note")

    base = max(abs(float(left["value"])), abs(float(right["value"])), 1.0)
    delta = round_half_up(abs(float(left["value"]) - float(right["value"])), 2)
    delta_pct = round_half_up(delta / base, 4)

    status = FINDING_STATUS.MATCHED
    if delta_pct >= tolerance.get("blocking_pct", 1.0):
        status = FINDING_STATUS.BLOCKING
    elif delta_pct >= tolerance.get("advisory_pct", 0.0):
        status = FINDING_STATUS.ADVISORY

    severity = (
        "BLOCKING"
        if status == FINDING_STATUS.BLOCKING
        else ("ADVISORY" if status == FINDING_STATUS.ADVISORY else "INFO")
    )

    return {
        "code": code,
        "label": label,
        "status": status,
        "severity": severity,
        "comparison": {"left": left, "right": right},
        "delta": delta,
        "delta_pct": delta_pct,
        "tolerance": tolerance,
        "evidence": evidence,
        "note": note,
        "resolution": None,
    }


def score_finding(args: Dict[str, Any]) -> Dict[str, Any]:
    code = args["code"]
    label = args["label"]
    left = args["left"]
    right = args["right"]
    tolerance = args["tolerance"]
    evidence = args["evidence"]
    similarity = args["similarity"]
    note = args.get("note")

    status = FINDING_STATUS.MATCHED
    if similarity < tolerance.get("blocking_score", 0.0):
        status = FINDING_STATUS.BLOCKING
    elif similarity < tolerance.get("advisory_score", 0.0):
        status = FINDING_STATUS.MISMATCH

    severity = (
        "BLOCKING"
        if status == FINDING_STATUS.BLOCKING
        else ("ADVISORY" if status == FINDING_STATUS.MISMATCH else "INFO")
    )

    return {
        "code": code,
        "label": label,
        "status": status,
        "severity": severity,
        "comparison": {"left": left, "right": right},
        "similarity": similarity,
        "tolerance": tolerance,
        "evidence": evidence,
        "note": note,
        "resolution": None,
    }


def mean_of(xs: Optional[List[Any]]) -> float:
    if not xs:
        return 0.0
    return round_half_up(sum(float(x) for x in xs) / len(xs), 2)


def reconcile(args: Dict[str, Any]) -> Dict[str, Any]:
    """Reconcile a validated evidence bundle across documents."""
    evidence = args.get("evidence", {})
    loan_request = args.get("loanRequest", {})
    credit_metrics = args.get("creditMetrics", {})
    policy = args.get("policy", {})
    tol = policy.get("reconciliation", {})

    findings = []
    applicant = evidence.get("applicant", {})
    bank = evidence.get("bank", {})
    platform = evidence.get("platform") or {}
    invoice = evidence.get("invoice", {})

    # 1 — Declared income vs verified bank income
    if applicant.get("declared_monthly_income") is not None:
        findings.append(
            pct_finding(
                {
                    "code": "RC-INC-01",
                    "label": "Declared income vs verified bank income",
                    "left": {
                        "field": "Declared monthly income",
                        "value": round_half_up(applicant["declared_monthly_income"], 2),
                        "source": "Application form",
                        "kind": "money",
                    },
                    "right": {
                        "field": "Verified monthly income",
                        "value": credit_metrics.get("metrics", {}).get(
                            "verified_monthly_income"
                        ),
                        "source": "BankStatement.pdf",
                        "kind": "money",
                    },
                    "tolerance": tol.get("income_declared_vs_verified", {}),
                    "evidence": [
                        "applicant.declared_monthly_income",
                        "income.verified_monthly_income",
                    ],
                    "note": "Verified income is derived from qualifying credits after policy haircuts.",
                }
            )
        )

    # 2 — Platform earnings vs bank credits
    if platform.get("monthly_net"):
        plat_mean = mean_of(platform["monthly_net"])
        bank_mean = mean_of(bank.get("monthly_credits"))
        findings.append(
            pct_finding(
                {
                    "code": "RC-INC-02",
                    "label": "Platform settlements vs bank credits",
                    "left": {
                        "field": "Mean monthly platform settlement",
                        "value": plat_mean,
                        "source": f"{platform.get('provider', 'Platform')}Earnings.pdf",
                        "kind": "money",
                    },
                    "right": {
                        "field": "Mean monthly bank credits",
                        "value": bank_mean,
                        "source": "BankStatement.pdf",
                        "kind": "money",
                    },
                    "tolerance": tol.get("platform_vs_bank_credits", {}),
                    "evidence": ["platform.monthly_net", "bank.monthly_credits"],
                    "note": "Settlements should land in the linked account; a large gap suggests an undisclosed account.",
                }
            )
        )

    # 3 — Invoice amount vs on-road price
    computed_on_road = round_half_up(
        float(invoice.get("ex_showroom") or 0)
        + float(invoice.get("insurance") or 0)
        + float(invoice.get("registration") or 0)
        + float(invoice.get("accessories") or 0),
        2,
    )
    findings.append(
        pct_finding(
            {
                "code": "RC-AST-01",
                "label": "Invoice ex-showroom + charges vs stated on-road price",
                "left": {
                    "field": "Computed on-road total",
                    "value": computed_on_road,
                    "source": "DealerInvoice.pdf",
                    "kind": "money",
                },
                "right": {
                    "field": "Stated on-road price",
                    "value": round_half_up(invoice.get("on_road_price", 0), 2),
                    "source": "DealerInvoice.pdf",
                    "kind": "money",
                },
                "tolerance": tol.get("invoice_vs_onroad", {}),
                "evidence": ["invoice.ex_showroom", "invoice.on_road_price"],
                "note": "Inflated on-road price is the common route to an over-funded asset.",
            }
        )
    )

    # 4 — Applicant name vs bank account holder
    name_sim = name_similarity(applicant.get("name"), bank.get("account_holder_name"))
    findings.append(
        score_finding(
            {
                "code": "RC-KYC-01",
                "label": "Applicant name vs bank account holder name",
                "left": {
                    "field": "Applicant name",
                    "value": applicant.get("name"),
                    "source": "Aadhaar.pdf",
                    "kind": "text",
                },
                "right": {
                    "field": "Bank account holder",
                    "value": bank.get("account_holder_name"),
                    "source": "BankStatement.pdf",
                    "kind": "text",
                },
                "similarity": name_sim,
                "tolerance": tol.get("name_match", {}),
                "evidence": ["applicant.name", "bank.account_holder_name"],
                "note": "Repayment must be collected from an account the borrower owns.",
            }
        )
    )

    # 5 — KYC name vs PAN name
    if applicant.get("pan_name"):
        pan_sim = name_similarity(applicant.get("name"), applicant.get("pan_name"))
        findings.append(
            score_finding(
                {
                    "code": "RC-KYC-02",
                    "label": "Aadhaar name vs PAN name",
                    "left": {
                        "field": "Aadhaar name",
                        "value": applicant.get("name"),
                        "source": "Aadhaar.pdf",
                        "kind": "text",
                    },
                    "right": {
                        "field": "PAN name",
                        "value": applicant.get("pan_name"),
                        "source": "PAN.pdf",
                        "kind": "text",
                    },
                    "similarity": pan_sim,
                    "tolerance": tol.get("name_match", {}),
                    "evidence": ["applicant.name", "applicant.pan_name"],
                }
            )
        )

    # 6 — KYC address vs bank statement address
    if bank.get("address"):
        addr_sim = address_similarity(applicant.get("address"), bank.get("address"))
        findings.append(
            score_finding(
                {
                    "code": "RC-ADR-01",
                    "label": "KYC address vs bank statement address",
                    "left": {
                        "field": "KYC address",
                        "value": applicant.get("address"),
                        "source": "Aadhaar.pdf",
                        "kind": "text",
                    },
                    "right": {
                        "field": "Statement address",
                        "value": bank.get("address"),
                        "source": "BankStatement.pdf",
                        "kind": "text",
                    },
                    "similarity": addr_sim,
                    "tolerance": tol.get("address_match", {}),
                    "evidence": ["applicant.address", "bank.address"],
                    "note": "Address drift is expected for migrant borrowers; treated as advisory, not disqualifying.",
                }
            )
        )

    # 7 — Requested amount vs invoice-supported amount
    findings.append(
        pct_finding(
            {
                "code": "RC-LON-01",
                "label": "Requested loan vs invoice-supported funding",
                "left": {
                    "field": "Requested loan amount",
                    "value": round_half_up(loan_request.get("amount", 0), 2),
                    "source": "Application form",
                    "kind": "money",
                },
                "right": {
                    "field": "Invoice on-road price",
                    "value": round_half_up(invoice.get("on_road_price", 0), 2),
                    "source": "DealerInvoice.pdf",
                    "kind": "money",
                },
                "tolerance": {"advisory_pct": 1, "blocking_pct": 1.01},
                "evidence": ["loan.amount", "invoice.on_road_price"],
                "note": "Funding headroom is governed by the LTV rule; shown here for context.",
            }
        )
    )

    # 8 — Vehicle segment vs invoice description
    if invoice.get("vehicle_category"):
        agrees = invoice["vehicle_category"] == loan_request.get("segment")
        findings.append(
            {
                "code": "RC-AST-02",
                "label": "Applied asset segment vs invoiced vehicle category",
                "status": (
                    FINDING_STATUS.MATCHED if agrees else FINDING_STATUS.BLOCKING
                ),
                "severity": "INFO" if agrees else "BLOCKING",
                "comparison": {
                    "left": {
                        "field": "Applied segment",
                        "value": loan_request.get("segment"),
                        "source": "Application form",
                        "kind": "text",
                    },
                    "right": {
                        "field": "Invoiced category",
                        "value": invoice["vehicle_category"],
                        "source": "DealerInvoice.pdf",
                        "kind": "text",
                    },
                },
                "tolerance": None,
                "evidence": ["loan.segment", "invoice.vehicle_category"],
                "note": "Product pricing and caps are segment-specific.",
                "resolution": None,
            }
        )

    return summarise(findings)


def summarise(findings: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Recount severities across findings, considering officer waivers."""
    live = [f for f in findings if (f.get("resolution") or {}).get("action") != "WAIVED"]
    blocking_count = sum(1 for f in live if f.get("status") == FINDING_STATUS.BLOCKING)

    advisory_count = sum(
        1
        for f in live
        if f.get("status") in (FINDING_STATUS.ADVISORY, FINDING_STATUS.MISMATCH)
    )
    matched_count = sum(1 for f in findings if f.get("status") == FINDING_STATUS.MATCHED)

    return {
        "findings": findings,
        "blocking": blocking_count,
        "advisory": advisory_count,
        "matched": matched_count,
        "total": len(findings),
    }
