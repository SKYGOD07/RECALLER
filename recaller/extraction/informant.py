"""RECALLER — informal-lender reference: attestation quality and ledger coherence.

A thin-file borrower is rarely a no-credit borrower. They have usually been
lent to for years — by a shopkeeper, a chit fund, a private moneylender — and
repaid. Nobody wrote it down. An *informant* is that counterparty, stating on
the record what they lent and how they were repaid.

That statement is evidence, and it is treated as evidence: typed, scored and
sourced like anything read off a bank statement. What it is not is a
verification. Nothing here can raise a policy ceiling or manufacture income.
What it can do is add an obligation the bank statement never revealed, and
supply a repayment record no bureau holds.

Confidence on these fields is computed, never sampled. It answers one question
— how much of this attestation can we actually stand behind — from four
measurable signals:

  completeness  how much of the reference was actually filled in
  verification  whether an officer reached the informant at the stated contact
  depth         how long the lending relationship has run
  coherence     whether the informant's own numbers agree with each other

The last is the sharpest. Principal lent, amount still outstanding, monthly
repayment and months known are four numbers describing one loan; they imply
each other. When they do not, the reference has a problem no amount of
confident parsing can fix, and the file goes to a human.
"""

from typing import Any, Dict, List, Optional

from ..core.constants import INFORMANT_ARMS_LENGTH, PROVENANCE
from ..core.money import round_half_up, to_paise, to_rupees

# Fields that describe who the informant is.
IDENTITY_PATHS = (
    "informant.name",
    "informant.relationship",
    "informant.business_name",
    "informant.contact",
    "informant.contact_verified",
    "informant.borrower_known_as",
    "informant.attested_at",
    "informant.note",
)

# Fields that describe the loan itself — these carry the coherence penalty.
LEDGER_PATHS = (
    "informant.months_known",
    "informant.principal_lent",
    "informant.current_outstanding",
    "informant.monthly_repayment",
    "informant.missed_payments_12m",
    "informant.longest_delay_days",
    "informant.would_lend_again",
)

# What a complete reference looks like. Completeness is measured against this,
# not against everything the schema permits — a note is nice, not material.
EXPECTED_PATHS = (
    "informant.name",
    "informant.relationship",
    "informant.contact",
    "informant.months_known",
    "informant.principal_lent",
    "informant.current_outstanding",
    "informant.monthly_repayment",
    "informant.missed_payments_12m",
    "informant.attested_at",
)

DEFAULTS = {
    "source_confidence_ceiling": 0.74,
    "unverified_contact_ceiling": 0.62,
    "non_arms_length_ceiling": 0.55,
    "min_months_known": 6,
    "ledger_tolerance_months": 1.5,
}


def _settings(policy: Dict[str, Any]) -> Dict[str, Any]:
    cfg = dict(DEFAULTS)
    cfg.update((policy.get("confidence") or {}).get("informant") or {})
    return cfg


def _num(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _money(value: Any) -> Optional[float]:
    n = _num(value)
    return None if n is None else to_rupees(to_paise(n))


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().upper() in ("TRUE", "YES", "Y", "1", "VERIFIED")


def completeness(informant: Dict[str, Any]) -> float:
    """Share of the expected reference fields that were actually supplied."""
    present = 0
    for path in EXPECTED_PATHS:
        key = path.split(".", 1)[1]
        value = informant.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        present += 1
    return round_half_up(present / len(EXPECTED_PATHS), 4)


def ledger_coherence(
    informant: Dict[str, Any], policy: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Do the informant's four numbers describe the same loan?

    A reference saying "I lent 45,000, he still owes 12,000, he pays me 3,000 a
    month, I have known him 34 months" is coherent: 33,000 repaid at 3,000 a
    month is 11 months of repayment, comfortably inside 34. One saying he has
    repaid 90,000 of a 45,000 loan is not, and no parser confidence rescues it.
    """
    cfg = _settings(policy or {})
    problems: List[Dict[str, Any]] = []

    principal = _money(informant.get("principal_lent"))
    outstanding = _money(informant.get("current_outstanding"))
    monthly = _money(informant.get("monthly_repayment"))
    months_known = _num(informant.get("months_known"))
    missed = _num(informant.get("missed_payments_12m"))

    # Not enough numbers to check anything. Unknown is not the same as wrong,
    # so this scores as a partial rather than a failure.
    if principal is None or outstanding is None:
        return {
            "score": 0.7,
            "checkable": False,
            "problems": [],
            "implied_months_repaid": None,
            "implied_months_remaining": None,
        }

    score = 1.0

    if outstanding > principal:
        problems.append(
            {
                "code": "OUTSTANDING_EXCEEDS_PRINCIPAL",
                "detail": "Outstanding {0} exceeds principal lent {1}.".format(
                    _inr(outstanding), _inr(principal)
                ),
                "weight": 0.45,
            }
        )
        score -= 0.45

    repaid = max(0.0, principal - outstanding)
    implied_months_repaid = None
    implied_months_remaining = None

    if monthly is not None and monthly > 0:
        implied_months_repaid = round_half_up(repaid / monthly, 2)
        if outstanding > 0:
            implied_months_remaining = round_half_up(outstanding / monthly, 2)

        if months_known is not None:
            allowance = months_known + float(cfg["ledger_tolerance_months"])
            if implied_months_repaid > allowance:
                overshoot = implied_months_repaid - allowance
                # Scaled, not binary: two months over is a rounding argument,
                # two years over is a different loan.
                penalty = min(0.45, 0.08 + overshoot * 0.03)
                problems.append(
                    {
                        "code": "REPAYMENT_EXCEEDS_RELATIONSHIP",
                        "detail": (
                            "{0} repaid at {1}/month implies {2:g} months of repayment, "
                            "but the relationship is stated as {3:g} months.".format(
                                _inr(repaid), _inr(monthly), implied_months_repaid, months_known
                            )
                        ),
                        "weight": round_half_up(penalty, 4),
                    }
                )
                score -= penalty
    elif outstanding > 0:
        problems.append(
            {
                "code": "OUTSTANDING_WITHOUT_REPAYMENT",
                "detail": "{0} outstanding but no monthly repayment stated.".format(
                    _inr(outstanding)
                ),
                "weight": 0.2,
            }
        )
        score -= 0.2

    if missed is not None and months_known is not None:
        observable = min(12.0, months_known)
        if missed > observable:
            problems.append(
                {
                    "code": "MISSED_EXCEEDS_OBSERVABLE",
                    "detail": (
                        "{0:g} missed payments reported over a relationship of only "
                        "{1:g} months.".format(missed, months_known)
                    ),
                    "weight": 0.2,
                }
            )
            score -= 0.2

    return {
        "score": round_half_up(max(0.0, min(1.0, score)), 4),
        "checkable": True,
        "problems": problems,
        "implied_months_repaid": implied_months_repaid,
        "implied_months_remaining": implied_months_remaining,
    }


def _inr(amount: float) -> str:
    """Plain rupee rendering for finding text. Display only."""
    return "₹{0:,.0f}".format(float(amount))


def attestation_quality(
    informant: Dict[str, Any], policy: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """The full deterministic confidence picture for one informant reference."""
    cfg = _settings(policy or {})

    comp = completeness(informant)
    coherence = ledger_coherence(informant, policy)
    verified = _truthy(informant.get("contact_verified"))
    relationship = str(informant.get("relationship") or "").strip().upper()
    arms_length = relationship in INFORMANT_ARMS_LENGTH

    months_known = _num(informant.get("months_known")) or 0.0
    min_months = float(cfg["min_months_known"])
    # Saturates at twice the policy minimum; a ten-year relationship is not
    # twice as attestable as a five-year one.
    depth = (
        round_half_up(max(0.0, min(1.0, months_known / (min_months * 2.0))), 4)
        if min_months > 0
        else 1.0
    )

    ceiling = float(cfg["source_confidence_ceiling"])
    if not verified:
        ceiling = min(ceiling, float(cfg["unverified_contact_ceiling"]))
    if not arms_length:
        ceiling = min(ceiling, float(cfg["non_arms_length_ceiling"]))

    # Identity: who they are, and that we reached them.
    identity = 0.55 + 0.30 * comp + 0.15 * (1.0 if verified else 0.0)
    # Ledger: the same, then multiplied down by whether the numbers agree.
    ledger = (0.50 + 0.25 * comp + 0.25 * depth) * coherence["score"]

    return {
        "completeness": comp,
        "coherence": coherence,
        "contact_verified": verified,
        "arms_length": arms_length,
        "relationship": relationship or None,
        "months_known": months_known,
        "depth": depth,
        "ceiling": round_half_up(ceiling, 4),
        "identity_confidence": round_half_up(max(0.05, min(ceiling, identity)), 4),
        "ledger_confidence": round_half_up(max(0.05, min(ceiling, ledger)), 4),
    }


def confidence_for(
    path: str,
    informant: Dict[str, Any],
    policy: Optional[Dict[str, Any]] = None,
    quality: Optional[Dict[str, Any]] = None,
) -> float:
    """Confidence for one informant field, from the reference's overall quality."""
    q = quality or attestation_quality(informant, policy)
    if path in LEDGER_PATHS:
        return q["ledger_confidence"]
    return q["identity_confidence"]


def is_attested(field_or_spec: Dict[str, Any]) -> bool:
    """True for evidence a third party asserted rather than a document showed."""
    if field_or_spec.get("provenance") == PROVENANCE.INFORMANT:
        return True
    return bool(field_or_spec.get("attested"))
