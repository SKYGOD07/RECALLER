"""Toolsets.

Adapted from NousResearch/hermes-agent ``toolsets.py`` (MIT): named groups of
tools, resolved recursively through ``includes``. Hermes ships dozens
(terminal, browser, web, memory, cron…). RECALLER ships only what a credit
reasoning agent needs. None of these tools reaches the network, the filesystem
or the deterministic engines' inputs, so least privilege is the default rather
than a setting.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Set

TOOLSETS: Dict[str, Dict] = {
    "evidence": {
        "description": "Read one document and record grounded evidence fields from it.",
        "tools": ["read_document", "record_evidence", "flag_issue"],
    },
    "review": {
        "description": "Read a finished file (evidence, reconciliation, engine output) and flag concerns.",
        "tools": ["read_evidence", "get_reconciliation", "get_credit_result", "get_policy_result", "flag_issue"],
    },
    "narration": {
        "description": "Read a finished decision record in order to explain it.",
        "tools": ["read_decision"],
    },
    "delegation": {
        "description": "Hand a reasoning-heavy subtask to an isolated child agent.",
        "tools": ["delegate_task"],
    },
    "supervisor": {
        "description": "Coordinate child reviewers over a finished file.",
        "tools": [],
        "includes": ["review", "delegation"],
    },
}


def resolve_toolset(name: str, _seen: Optional[Set[str]] = None) -> List[str]:
    """Every tool name in a toolset, following ``includes`` (cycles are ignored)."""
    seen = _seen if _seen is not None else set()
    ts = TOOLSETS.get(name)
    if ts is None:
        raise KeyError(f'Unknown toolset "{name}".')
    if name in seen:
        return []
    seen.add(name)
    out: List[str] = list(ts["tools"])
    for inc in ts.get("includes", []):
        out.extend(resolve_toolset(inc, seen))
    return list(dict.fromkeys(out))


def resolve_toolsets(names: Iterable[str]) -> List[str]:
    out: List[str] = []
    for n in names:
        out.extend(resolve_toolset(n))
    return list(dict.fromkeys(out))
