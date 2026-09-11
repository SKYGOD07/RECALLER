"""RECALLER — deterministic money primitives.

All monetary arithmetic is carried out in integer paise to remove binary
floating point drift from the credit path. Every function here is pure and
produces byte-identical output for identical input.
"""

from decimal import Decimal, ROUND_HALF_UP
import math
import re
from typing import Any, Optional, Sequence, Union


def to_paise(rupees: Any) -> int:
    """Convert rupees (number or numeric string) to integer paise."""
    if rupees is None or rupees == "":
        return 0
    if isinstance(rupees, str):
        cleaned = re.sub(r"[,\s₹]", "", rupees)
        try:
            val = float(cleaned)
        except ValueError as e:
            raise TypeError(f"to_paise: not a finite number: {rupees}") from e
    else:
        try:
            val = float(rupees)
        except (ValueError, TypeError) as e:
            raise TypeError(f"to_paise: not a finite number: {rupees}") from e

    if not math.isfinite(val):
        raise TypeError(f"to_paise: not a finite number: {rupees}")

    # Scale then round half-up away from zero
    scaled = val * 100.0
    sign = -1 if scaled < 0 else 1
    abs_scaled = abs(scaled)
    # 2.220446049250313e-16 is JS Number.EPSILON
    epsilon = 2.220446049250313e-16
    return sign * int(math.floor(abs_scaled + epsilon * abs_scaled + 0.5))


def to_rupees(paise: Union[int, float]) -> float:
    """Convert integer paise back to a rupee float with 2 decimal places."""
    return round_half_up(paise / 100.0, 2)


def round_half_up(value: Union[int, float], dp: int = 2) -> float:
    """Half-up rounding away from zero to a fixed number of decimal places."""
    if value is None or not math.isfinite(value):
        return 0.0
    f = 10**dp
    sign = -1 if value < 0 else 1
    abs_val = abs(value) * f
    epsilon = 2.220446049250313e-16
    rounded = int(math.floor(abs_val + epsilon * abs_val + 0.5))
    return (sign * rounded) / f


# Alias for compatibility
round_num = round_half_up


def sum_rupees(amounts: Sequence[Any]) -> float:
    """Sum a list of rupee amounts in integer paise without accumulating float error."""
    total_paise = sum(to_paise(a) for a in amounts)
    return to_rupees(total_paise)


def format_inr(
    rupees: Any, decimals: int = 0, symbol: bool = True
) -> str:
    """Format as Indian-grouped currency, e.g. ₹1,23,45,678 or ₹1,23,456.00."""
    if rupees is None or rupees == "":
        return "—"
    try:
        n = float(rupees)
    except (ValueError, TypeError):
        return "—"
    if not math.isfinite(n):
        return "—"

    neg = n < 0
    abs_n = abs(n)
    if decimals > 0:
        fixed = f"{abs_n:.{decimals}f}"
        whole, frac = fixed.split(".")
    else:
        whole = str(int(round_half_up(abs_n, 0)))
        frac = ""

    last3 = whole[-3:] if len(whole) >= 3 else whole
    rest = whole[:-3] if len(whole) >= 3 else ""

    if rest:
        # Group remaining digits in pairs from right to left
        grouped_rest = re.sub(r"\B(?=(\d{2})+(?!\d))", ",", rest)
        grouped = f"{grouped_rest},{last3}"
    else:
        grouped = last3

    prefix = ("-" if neg else "") + ("₹" if symbol else "")
    suffix = f".{frac}" if frac else ""
    return f"{prefix}{grouped}{suffix}"


def format_pct(ratio: Any, dp: int = 1) -> str:
    """Format a ratio as a percentage string (e.g. 0.3 -> 30.0%)."""
    if ratio is None or ratio == "":
        return "—"
    try:
        val = float(ratio)
    except (ValueError, TypeError):
        return "—"
    if not math.isfinite(val):
        return "—"
    pct = round_half_up(val * 100.0, dp)
    if dp == 0:
        return f"{int(pct)}%"
    return f"{pct:.{dp}f}%"
