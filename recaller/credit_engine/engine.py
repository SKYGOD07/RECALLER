"""RECALLER — deterministic credit calculation engine.

This module is the ONLY place in the system permitted to produce EMI, FOIR,
LTV, obligation totals or recognised income. Every function is pure: same
inputs, same outputs, forever.
"""

import math
from typing import Any, Dict, List, Optional, Union
from ..core.constants import ENGINE_VERSION
from ..core.hash import hash_value
from ..core.money import format_inr, round_half_up, sum_rupees, to_paise, to_rupees


def calculate_emi(
    principal: Union[int, float, str],
    annual_rate_pct: Union[int, float],
    tenure_months: Union[int, float],
) -> float:
    """Equated Monthly Instalment on a reducing-balance loan.

    EMI = P · r · (1+r)^n / ((1+r)^n − 1), r = annual rate / 12 / 100
    """
    p = to_rupees(to_paise(principal))
    try:
        n = int(round_half_up(float(tenure_months), 0))
    except (ValueError, TypeError):
        n = 0
    if not (p > 0) or not (n > 0):
        return 0.0
    r = float(annual_rate_pct) / 12.0 / 100.0
    if r == 0:
        return round_half_up(p / n, 2)
    growth = (1.0 + r) ** n
    return round_half_up((p * r * growth) / (growth - 1.0), 2)


def amortisation_schedule(
    principal: Union[int, float, str],
    annual_rate_pct: Union[int, float],
    tenure_months: Union[int, float],
) -> Dict[str, Any]:
    """Full amortisation schedule. Interest is computed on opening balance.

    Final instalment absorbs residue so schedule closes at exactly zero.
    """
    emi = calculate_emi(principal, annual_rate_pct, tenure_months)
    n = int(round_half_up(float(tenure_months), 0))
    r = float(annual_rate_pct) / 12.0 / 100.0
    balance_paise = to_paise(principal)
    rows = []
    for m in range(1, n + 1):
        opening = balance_paise
        interest = int(round_half_up(opening * r, 0))
        payment = to_paise(emi)
        principal_part = payment - interest
        if m == n or principal_part >= opening:
            principal_part = opening
            payment = principal_part + interest
        balance_paise = opening - principal_part
        rows.append(
            {
                "month": m,
                "opening": to_rupees(opening),
                "payment": to_rupees(payment),
                "interest": to_rupees(interest),
                "principal": to_rupees(principal_part),
                "closing": to_rupees(balance_paise),
            }
        )
        if balance_paise <= 0:
            break

    total_interest = to_rupees(sum(to_paise(x["interest"]) for x in rows))
    total_payable = round_half_up(to_rupees(to_paise(principal)) + total_interest, 2)
    return {
        "emi": emi,
        "rows": rows,
        "totalInterest": total_interest,
        "totalPayable": total_payable,
    }


def calculate_foir(
    verified_monthly_income: Any,
    existing_obligations: Any,
    proposed_emi: Any,
    ratio_dp: int = 4,
) -> Optional[float]:
    """Fixed Obligation to Income Ratio (FOIR)."""
    income = to_rupees(to_paise(verified_monthly_income))
    if not (income > 0):
        return None
    outflow = to_rupees(to_paise(existing_obligations) + to_paise(proposed_emi))
    return round_half_up(outflow / income, ratio_dp)


def calculate_ltv(
    loan_amount: Any, asset_value: Any, ratio_dp: int = 4
) -> Optional[float]:
    """Loan to Value (LTV)."""
    value = to_rupees(to_paise(asset_value))
    if not (value > 0):
        return None
    return round_half_up(to_rupees(to_paise(loan_amount)) / value, ratio_dp)


def calculate_obligations(recurring_debits: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Total existing monthly obligations from classified recurring debits."""
    if not recurring_debits:
        return {"total": 0.0, "items": []}

    items = []
    for d in recurring_debits:
        if d.get("isObligation") is not False:
            amt = to_rupees(to_paise(d.get("amount", 0)))
            items.append(
                {
                    "label": d.get("label", ""),
                    "amount": amt,
                    "kind": d.get("kind", "LOAN_EMI"),
                    "source": d.get("source"),
                }
            )
    return {"total": sum_rupees([i["amount"] for i in items]), "items": items}


def mean(xs: List[Any]) -> float:
    if not xs:
        return 0.0
    total_paise = sum(to_paise(x) for x in xs)
    return to_rupees(int(round_half_up(total_paise / len(xs), 0)))


def coefficient_of_variation(xs: List[Any]) -> float:
    """Coefficient of variation — standard deviation over mean. Ratio, 4dp."""
    if len(xs) < 2:
        return 0.0
    m = mean(xs)
    if not (m > 0):
        return 0.0
    variance = sum((x - m) ** 2 for x in xs) / len(xs)
    return round_half_up(math.sqrt(variance) / m, 4)


def calculate_verified_income(
    input_data: Dict[str, Any], rules: Dict[str, Any]
) -> Dict[str, Any]:
    """Recognised (verified) monthly income using conservative lower-of rule."""
    credits = [to_rupees(to_paise(v)) for v in input_data.get("monthlyBankCredits") or []]
    cash = [to_rupees(to_paise(v)) for v in input_data.get("monthlyCashDeposits") or []]
    platform = [to_rupees(to_paise(v)) for v in input_data.get("monthlyPlatformNet") or []]
    window = rules.get("observation_window_months", 6)

    months_observed = len(credits)
    recent_credits = credits[-window:] if credits else []
    recent_cash = cash[-window:] if cash else []
    recent_platform = platform[-window:] if platform else []

    mean_credits = mean(recent_credits)
    mean_cash = mean(recent_cash)

    cash_haircut_rate = rules.get("cash_deposit_haircut", 0.0)
    max_cash_share = rules.get("max_cash_share_of_income", 1.0)
    platform_haircut_rate = rules.get("platform_earnings_haircut", 0.0)

    cash_after_haircut = round_half_up(mean_cash * (1.0 - cash_haircut_rate), 2)
    banked_non_cash = round_half_up(max(mean_credits - mean_cash, 0.0), 2)
    denom = max(1.0 - max_cash_share, 0.0001)
    cash_cap = round_half_up((banked_non_cash * max_cash_share) / denom, 2)
    cash_admitted = round_half_up(min(cash_after_haircut, cash_cap), 2)
    bank_view = round_half_up(banked_non_cash + cash_admitted, 2)

    mean_platform = mean(recent_platform) if platform else 0.0
    platform_view = (
        round_half_up(mean_platform * (1.0 - platform_haircut_rate), 2)
        if len(platform) > 0
        else None
    )

    verified = bank_view if platform_view is None else round_half_up(min(bank_view, platform_view), 2)

    return {
        "verified_monthly_income": verified,
        "method": rules.get("method", "LOWER_OF_BANK_CREDIT_RUNRATE_AND_PLATFORM_NET"),
        "months_observed": months_observed,
        "window_months": window,
        "bank_view": bank_view,
        "platform_view": platform_view,
        "components": {
            "mean_monthly_credits": round_half_up(mean_credits, 2),
            "mean_monthly_cash": round_half_up(mean_cash, 2),
            "cash_after_haircut": cash_after_haircut,
            "cash_admitted": cash_admitted,
            "banked_non_cash": banked_non_cash,
            "mean_platform_settlement": round_half_up(mean_platform, 2),
            "platform_haircut": platform_haircut_rate,
            "cash_haircut": cash_haircut_rate,
        },
        "volatility": coefficient_of_variation(recent_credits),
    }


def compute_credit_metrics(
    evidence: Dict[str, Any], loan_request: Dict[str, Any], policy: Dict[str, Any]
) -> Dict[str, Any]:
    """Single entry point for deterministic credit calculation."""
    segment_code = loan_request.get("segment")
    segment = policy.get("segments", {}).get(segment_code)
    if not segment:
        raise ValueError(f"Unknown asset segment: {segment_code}")

    rate = loan_request.get("rateAnnualPct")
    if rate is None:
        rate = segment.get("rate_annual_pct", 15.0)

    tenure = int(round_half_up(float(loan_request.get("tenureMonths", 0)), 0))
    amount = to_rupees(to_paise(loan_request.get("amount", 0)))

    bank_ev = evidence.get("bank", {})
    platform_ev = evidence.get("platform")
    invoice_ev = evidence.get("invoice", {})
    applicant_ev = evidence.get("applicant", {})

    income = calculate_verified_income(
        {
            "monthlyBankCredits": bank_ev.get("monthly_credits"),
            "monthlyCashDeposits": bank_ev.get("monthly_cash_deposits"),
            "monthlyPlatformNet": platform_ev.get("monthly_net") if platform_ev else None,
        },
        policy.get("income_recognition", {}),
    )

    obligations = calculate_obligations(bank_ev.get("recurring_debits", []))
    emi = calculate_emi(amount, rate, tenure)
    ratio_dp = policy.get("rounding", {}).get("ratio_dp", 4)
    foir = calculate_foir(income["verified_monthly_income"], obligations["total"], emi, ratio_dp)

    invoice_value = to_rupees(to_paise(invoice_ev.get("on_road_price", 0)))
    alt_val = invoice_ev.get("assessed_value")
    alt_value = to_rupees(to_paise(alt_val)) if alt_val is not None else None
    asset_value = invoice_value if alt_value is None else min(invoice_value, alt_value)
    ltv = calculate_ltv(amount, asset_value, ratio_dp)

    schedule = amortisation_schedule(amount, rate, tenure)
    disposable = round_half_up(income["verified_monthly_income"] - obligations["total"] - emi, 2)

    app_age = applicant_ev.get("age")
    age_at_maturity = (
        round_half_up(app_age + tenure / 12.0, 1) if app_age is not None else None
    )

    inputs = {
        "verified_monthly_income": income["verified_monthly_income"],
        "existing_obligations": obligations["total"],
        "loan_amount": amount,
        "tenure_months": tenure,
        "rate_annual_pct": rate,
        "asset_value": asset_value,
        "invoice_on_road_price": invoice_value,
        "assessed_value": alt_value,
        "months_observed": income["months_observed"],
    }

    return {
        "engine_version": ENGINE_VERSION,
        "inputs": inputs,
        "metrics": {
            "emi": emi,
            "foir": foir,
            "ltv": ltv,
            "obligations": obligations["total"],
            "verified_monthly_income": income["verified_monthly_income"],
            "disposable_income": disposable,
            "income_volatility": income["volatility"],
            "income_months_observed": income["months_observed"],
            "average_monthly_balance": round_half_up(bank_ev.get("average_monthly_balance", 0), 2),
            "bounce_count": bank_ev.get("bounce_count", 0),
            "applicant_age": app_age,
            "age_at_maturity": age_at_maturity,
            "total_interest": schedule["totalInterest"],
            "total_payable": schedule["totalPayable"],
            "loan_amount": amount,
            "tenure_months": tenure,
        },
        "income_breakdown": income,
        "obligation_breakdown": obligations,
        "schedule": schedule["rows"],
        "input_hash": hash_value(inputs),
    }
