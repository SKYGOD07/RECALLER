"""RECALLER agent runtime — toolset groupings and resolution."""

from typing import Dict, List, Optional, Set

TOOLSETS = {
    "evidence": {
        "description": "Read one document and record grounded evidence fields from it.",
        "tools": ["read_document", "record_evidence", "flag_issue"],
    },
    "review": {
        "description": "Read the gated evidence set and flag inconsistencies for the officer.",
        "tools": ["read_evidence", "flag_issue"],
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
        "description": "Coordinate child agents over an evidence set.",
        "tools": [],
        "includes": ["review", "delegation"],
    },
}


def resolve_toolset(name: str, seen: Optional[Set[str]] = None) -> List[str]:
    """Every tool name in a toolset, following includes recursively."""
    if seen is None:
        seen = set()
    ts = TOOLSETS.get(name)
    if not ts:
        raise ValueError(f'Unknown toolset "{name}".')
    if name in seen:
        return []
    seen.add(name)

    included = []
    for inc in ts.get("includes", []):
        included.extend(resolve_toolset(inc, seen))

    merged = list(ts.get("tools", [])) + included
    # Return unique items preserving deterministic order
    out = []
    for t in merged:
        if t not in out:
            out.append(t)
    return out


def resolve_toolsets(names: List[str]) -> List[str]:
    out = []
    for n in names:
        for t in resolve_toolset(n):
            if t not in out:
                out.append(t)
    return out
