"""Skills.

The NousResearch/hermes-agent skill format (MIT): a ``SKILL.md`` with YAML
frontmatter (``name``, ``description``, …) and a markdown body of procedure,
plus optional ``references/`` loaded when relevant. Skills are shipped as
package data under ``recaller/ai/hermes/skills/``. Only top-level
``key: value`` frontmatter is read; nested blocks such as ``metadata:`` are
skipped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

SKILLS_DIR = Path(__file__).resolve().parent / "skills"


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    meta: Dict[str, Any] = field(default_factory=dict)
    references: Dict[str, str] = field(default_factory=dict)


def parse_skill(markdown: str) -> Skill:
    text = str(markdown).lstrip("﻿")
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$", text)
    if not m:
        raise ValueError("SKILL.md must begin with a --- frontmatter block.")
    meta: Dict[str, Any] = {}
    for line in m.group(1).splitlines():
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if kv and kv.group(2).strip():
            meta[kv.group(1)] = _scalar(kv.group(2).strip())
    if not meta.get("name") or not meta.get("description"):
        raise ValueError("Skill frontmatter needs a name and a description.")
    return Skill(name=str(meta["name"]), description=str(meta["description"]), body=m.group(2).strip(), meta=meta)


def _scalar(v: str) -> Any:
    if v.startswith("[") and v.endswith("]"):
        return [_unquote(s.strip()) for s in v[1:-1].split(",") if s.strip()]
    if v in ("true", "false"):
        return v == "true"
    return _unquote(v)


def _unquote(s: str) -> str:
    return s[1:-1] if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"" else s


@lru_cache(maxsize=None)
def load_skill(name: str) -> Skill:
    base = SKILLS_DIR / name
    skill = parse_skill((base / "SKILL.md").read_text(encoding="utf-8"))
    refs_dir = base / "references"
    refs = {p.stem: p.read_text(encoding="utf-8") for p in sorted(refs_dir.glob("*.md"))} if refs_dir.is_dir() else {}
    return Skill(skill.name, skill.description, skill.body, skill.meta, refs)


def list_skills() -> List[Dict[str, Any]]:
    out = []
    for d in sorted(p for p in SKILLS_DIR.iterdir() if (p / "SKILL.md").is_file()):
        s = load_skill(d.name)
        out.append(
            {
                "name": s.name,
                "description": s.description,
                "version": s.meta.get("version"),
                "license": s.meta.get("license"),
                "author": s.meta.get("author"),
                "references": sorted(s.references),
            }
        )
    return out


def skill_prompt(skill: Skill, references: List[str] | None = None) -> str:
    """System-prompt text for a skill; ``references=None`` includes all of them."""
    names = sorted(skill.references) if references is None else references
    refs = [f"## Reference: {n}\n\n{skill.references[n].strip()}" for n in names if n in skill.references]
    return "\n\n".join([f"# Skill: {skill.name}", skill.body, *refs])
