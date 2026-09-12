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

    # 9..13 — informal-lender reference
    findings.extend(
        informant_findings(
            informant=evidence.get("informant") or {},
            applicant=applicant,
            credit_metrics=credit_metrics,
            policy=policy,
        )
    )

    return summarise(findings)


def informant_findings(
    informant: Dict[str, Any],
    applicant: Dict[str, Any],
    credit_metrics: Dict[str, Any],
    policy: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Cross-check what the informal lender said against what the file shows.

    The reference is the only evidence in the bundle nobody had to produce a
    document for, so it gets the most scrutiny — and it is also the only
    evidence that can reveal an obligation the bank statement never carried.
    """
    if not informant:
        return []

    tol = policy.get("reconciliation", {})
    cfg = policy.get("informal_credit", {})
    informal = credit_metrics.get("informal_credit") or {}
    findings: List[Dict[str, Any]] = []

    # 9 — Does the monthly repayment appear in the bank statement?
    if informal.get("applicable"):
        corroborated = bool(informal.get("corroborated"))
        matched = informal.get("matched_debit") or {}
        monthly = informal.get("monthly_repayment") or 0
        findings.append(
            {
                "code": "RC-INF-01",
                "label": "Informal repayment vs bank recurring debits",
                "status": FINDING_STATUS.MATCHED if corroborated else FINDING_STATUS.ADVISORY,
                "severity": "INFO" if corroborated else "ADVISORY",
                "comparison": {
                    "left": {
                        "field": "Repayment stated by informant",
                        "value": round_half_up(monthly, 2),
                        "source": "InformantReference.pdf",
                        "kind": "money",
                    },
                    "right": {
                        "field": matched.get("label") or "No matching recurring debit",
                        "value": round_half_up(matched.get("amount", 0), 2) if matched else 0,
                        "source": "BankStatement.pdf",
                        "kind": "money",
                    },
                },
                "tolerance": {"match_pct": informal.get("tolerance_pct")},
                "evidence": ["informant.monthly_repayment", "bank.recurring_debits"],
                "note": (
                    "The informal repayment is already visible in the statement and is counted once."
                    if corroborated
                    else
                    "No bank debit matches this repayment, so the obligation was not in the "
                    "file. The engine has added it to the obligation total."
                ),
                "resolution": None,
            }
        )

    # 10 — Does the informant ledger add up against itself?
    attestation = informant.get("_attestation") or {}
    coherence = attestation.get("coherence") or {}
    problems = coherence.get("problems") or []
    if coherence.get("checkable"):
        findings.append(
            {
                "code": "RC-INF-02",
                "label": "Informant ledger internal consistency",
                "status": FINDING_STATUS.MATCHED if not problems else FINDING_STATUS.ADVISORY,
                "severity": "INFO" if not problems else "ADVISORY",
                "comparison": {
                    "left": {
                        "field": "Implied months of repayment",
                        "value": coherence.get("implied_months_repaid"),
                        "source": "Derived from informant figures",
                        "kind": "number",
                    },
                    "right": {
                        "field": "Stated months of relationship",
                        "value": informant.get("months_known"),
                        "source": "InformantReference.pdf",
                        "kind": "number",
                    },
                },
                "tolerance": {"score": coherence.get("score")},
                "evidence": [
                    "informant.principal_lent",
                    "informant.current_outstanding",
                    "informant.monthly_repayment",
                    "informant.months_known",
                ],
                "note": (
                    problems[0].get("detail")
                    if problems
                    else "Principal, outstanding, repayment and tenure agree with each other."
                ),
                "resolution": None,
            }
        )

    # 11 — The repayment record itself. This is the point of the reference.
    missed = informant.get("missed_payments_12m")
    if missed is not None:
        max_missed = cfg.get("max_missed_payments_12m", 2)
        over = float(missed) > float(max_missed)
        findings.append(
            {
                "code": "RC-INF-03",
                "label": "Informal repayment conduct (last 12 months)",
                "status": FINDING_STATUS.ADVISORY if over else FINDING_STATUS.MATCHED,
                "severity": "ADVISORY" if over else "INFO",
                "comparison": {
                    "left": {
                        "field": "Missed payments reported",
                        "value": float(missed),
                        "source": "InformantReference.pdf",
                        "kind": "number",
                    },
                    "right": {
                        "field": "Policy tolerance",
                        "value": float(max_missed),
                        "source": "policy.informal_credit",
                        "kind": "number",
                    },
                },
                "tolerance": {"max_missed_payments_12m": max_missed},
                "evidence": ["informant.missed_payments_12m", "informant.longest_delay_days"],
                "note": (
                    "Informal repayment conduct is outside policy tolerance."
                    if over
                    else "A repayment record no bureau holds — the strongest signal a thin file has."
                ),
                "resolution": None,
            }
        )

    # 12 — Is the relationship long enough to mean anything?
    months_known = informant.get("months_known")
    if months_known is not None:
        min_months = cfg.get("min_months_known", 6)
        thin = float(months_known) < float(min_months)
        findings.append(
            {
                "code": "RC-INF-04",
                "label": "Depth of the lending relationship",
                "status": FINDING_STATUS.ADVISORY if thin else FINDING_STATUS.MATCHED,
                "severity": "ADVISORY" if thin else "INFO",
                "comparison": {
                    "left": {
                        "field": "Months known",
                        "value": float(months_known),
                        "source": "InformantReference.pdf",
                        "kind": "number",
                    },
                    "right": {
                        "field": "Policy minimum",
                        "value": float(min_months),
                        "source": "policy.informal_credit",
                        "kind": "number",
                    },
                },
                "tolerance": {"min_months_known": min_months},
                "evidence": ["informant.months_known"],
                "note": (
                    "Too short a relationship to carry weight as a credit reference."
                    if thin
                    else None
                ),
                "resolution": None,
            }
        )

    # 13 — Does the informant know the borrower by the name on the KYC?
    known_as = informant.get("borrower_known_as")
    if known_as:
        sim = name_similarity(applicant.get("name"), known_as)
        findings.append(
            score_finding(
                {
                    "code": "RC-INF-05",
                    "label": "Applicant name vs name the informant knows",
                    "left": {
                        "field": "Applicant name",
                        "value": applicant.get("name"),
                        "source": "Aadhaar.pdf",
                        "kind": "text",
                    },
                    "right": {
                        "field": "Known to informant as",
                        "value": known_as,
                        "source": "InformantReference.pdf",
                        "kind": "text",
                    },
                    "similarity": sim,
                    "tolerance": tol.get("informant_name_match", tol.get("name_match", {})),
                    "evidence": ["applicant.name", "informant.borrower_known_as"],
                    "note": "A reference is only a reference if it is about this borrower.",
                }
            )
        )

    return findings


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
