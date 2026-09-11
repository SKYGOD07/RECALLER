"""RECALLER agent runtime — skill parsing and prompt generation."""

import re
from typing import Any, Dict, Optional


def unquote(s: str) -> str:
    s = s.strip()
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')):
        return s[1:-1]
    return s


def parse_scalar(raw: str) -> Any:
    v = raw.strip()
    if v.startswith("[") and v.endswith("]"):
        items = v[1:-1].split(",")
        return [unquote(x.strip()) for x in items if x.strip()]
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    return unquote(v)


def parse_frontmatter(src: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for line in src.splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m and m.group(2) != "":
            out[m.group(1)] = parse_scalar(m.group(2))
    return out


def parse_skill(markdown: str) -> Dict[str, Any]:
    text = str(markdown or "").lstrip("\ufeff")
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$", text)
    if not m:
        raise ValueError("SKILL.md must begin with a --- frontmatter block.")
    meta = parse_frontmatter(m.group(1))
    if not meta.get("name") or not meta.get("description"):
        raise ValueError("Skill frontmatter needs a name and a description.")
    return {**meta, "body": m.group(2).strip()}


def skill_prompt(skill: Dict[str, Any], references: Optional[Dict[str, str]] = None) -> str:
    refs = [
        f"## Reference: {name}\n\n{str(text).strip()}"
        for name, text in (references or {}).items()
    ]
    parts = [f"# Skill: {skill.get('name')}", skill.get("body", "")] + refs
    return "\n\n".join(parts)
