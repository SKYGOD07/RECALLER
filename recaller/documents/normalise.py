"""Value normalisation shared by the pattern extractor and the evidence agent.

Reading, not arithmetic: these helpers turn printed text into typed values
(Indian-grouped amounts, dates in the formats KYC documents use) and test
whether a value really appears in a quoted snippet.
"""

from __future__ import annotations

import re
from datetime import date
from typing import List, Optional, Union

Number = Union[int, float]

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
_NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def squash(text: object) -> str:
    """Lower-case and collapse whitespace so line wrapping never defeats a verbatim match."""
    return re.sub(r"\s+", " ", str(text)).strip().lower()


def numbers_in(text: object) -> List[float]:
    """Every number printed in ``text``, with thousands separators removed."""
    return [float(n.replace(",", "")) for n in _NUM_RE.findall(str(text))]


def parse_number(value: object) -> Optional[Number]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    cleaned = re.sub(r"(?i)(rs\.?|inr|₹|/-|\s|,)", "", str(value))
    m = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not m:
        return None
    n = float(m.group(0))
    return int(n) if n.is_integer() else n


def number_list(text: object) -> List[Number]:
    out: List[Number] = []
    for n in numbers_in(text):
        out.append(int(n) if n.is_integer() else n)
    return out


def parse_date(value: object) -> Optional[str]:
    """ISO ``YYYY-MM-DD`` from the formats Indian KYC documents print; ``None`` if unreadable."""
    s = str(value).strip()
    candidates = [
        (r"^(\d{4})-(\d{1,2})-(\d{1,2})$", ("y", "m", "d")),
        (r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$", ("d", "m", "y")),
        (r"^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$", ("d", "mon", "y")),
        (r"^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$", ("mon", "d", "y")),
    ]
    for pattern, order in candidates:
        m = re.match(pattern, s)
        if not m:
            continue
        parts = dict(zip(order, m.groups()))
        month = _MONTHS.get(parts["mon"][:3].lower()) if "mon" in parts else int(parts["m"])
        try:
            return date(int(parts["y"]), int(month or 0), int(parts["d"])).isoformat()
        except (TypeError, ValueError):
            return None
    return None


def value_in_snippet(value: Number, snippet: str) -> bool:
    return any(abs(p - float(value)) < 1e-9 for p in numbers_in(snippet))
