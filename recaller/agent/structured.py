"""RECALLER agent runtime — structured output parsing and validation."""

import inspect
import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple, Union


def validate(schema: Dict[str, Any], value: Any, path: str = "$") -> List[str]:
    """Validate a value against JSON Schema subset."""
    errors: List[str] = []
    walk(schema, value, path, errors)
    return errors


def walk(s: Dict[str, Any], v: Any, p: str, errors: List[str]) -> None:
    if not isinstance(s, dict):
        return

    if "enum" in s and v not in s["enum"]:
        errors.append(f"{p}: must be one of {json.dumps(s['enum'])}")

    if "type" in s:
        types = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(is_type(t, v) for t in types):
            expected_str = " | ".join(types)
            errors.append(f"{p}: expected {expected_str}, got {type_name(v)}")
            return

    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in s and v < s["minimum"]:
            errors.append(f"{p}: must be ≥ {s['minimum']}")
        if "maximum" in s and v > s["maximum"]:
            errors.append(f"{p}: must be ≤ {s['maximum']}")

    if isinstance(v, str):
        if "minLength" in s and len(v) < s["minLength"]:
            errors.append(f"{p}: must be at least {s['minLength']} characters")
        if "maxLength" in s and len(v) > s["maxLength"]:
            errors.append(f"{p}: must be at most {s['maxLength']} characters")
        if "pattern" in s and not re.search(s["pattern"], v):
            errors.append(f"{p}: must match /{s['pattern']}/")

    if isinstance(v, list):
        if "minItems" in s and len(v) < s["minItems"]:
            errors.append(f"{p}: needs at least {s['minItems']} items")
        if "maxItems" in s and len(v) > s["maxItems"]:
            errors.append(f"{p}: allows at most {s['maxItems']} items")
        if "items" in s:
            for i, item in enumerate(v):
                walk(s["items"], item, f"{p}[{i}]", errors)

    if isinstance(v, dict):
        for req in s.get("required", []):
            if req not in v:
                errors.append(f"{p}.{req}: is required")
        for k, sub_schema in s.get("properties", {}).items():
            if k in v:
                walk(sub_schema, v[k], f"{p}.{k}", errors)
        if s.get("additionalProperties") is False:
            allowed_props = set(s.get("properties", {}).keys())
            for k in v.keys():
                if k not in allowed_props:
                    errors.append(f"{p}.{k}: is not allowed")


def is_type(t: str, v: Any) -> bool:
    if t == "string":
        return isinstance(v, str)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "array":
        return isinstance(v, list)
    if t == "object":
        return isinstance(v, dict)
    if t == "null":
        return v is None
    return True


def type_name(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    return type(v).__name__


def parse_json_reply(text: str) -> Dict[str, Any]:
    raw = str(text or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    body = fenced.group(1).strip() if fenced else raw
    start = -1
    for i, ch in enumerate(body):
        if ch in ("{", "["):
            start = i
            break
    if start == -1:
        return {"ok": False, "error": "no JSON object or array found"}

    end_brace = body.rfind("}")
    end_bracket = body.rfind("]")
    end = max(end_brace, end_bracket)
    try:
        val = json.loads(body[start : end + 1])
        return {"ok": True, "value": val}
    except Exception as err:
        return {"ok": False, "error": str(err)}


def check_schema(text: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    parsed = parse_json_reply(text)
    if not parsed["ok"]:
        return {"valid": False, "value": None, "errors": [f"not valid JSON: {parsed['error']}"]}
    errors = validate(schema, parsed["value"])
    return {"valid": len(errors) == 0, "value": parsed["value"], "errors": errors}


async def generate_structured(
    model: Callable[..., Any],
    prompt: str,
    schema: Dict[str, Any],
    system: str = "",
    max_retries: int = 2,
) -> Dict[str, Any]:
    """Prompt model for structured JSON, retrying with validation errors if malformed."""
    messages = [
        {
            "role": "user",
            "content": f"{prompt}\n\nReply with only JSON matching this schema:\n{json.dumps(schema)}",
        }
    ]
    errors = []
    for attempt in range(1, max_retries + 2):
        req = {"system": system, "messages": messages, "tools": []}
        reply = model(req)
        if inspect.isawaitable(reply):
            reply = await reply

        text = reply.get("content", "") if isinstance(reply, dict) else ""
        chk = check_schema(text, schema)
        if chk["valid"]:
            return {"ok": True, "value": chk["value"], "attempts": attempt}

        errors = chk["errors"]
        messages.append({"role": "assistant", "content": text})
        messages.append(
            {
                "role": "user",
                "content": f"That reply failed validation:\n- {'\n- '.join(errors)}\nReturn the corrected JSON only.",
            }
        )

    return {"ok": False, "errors": errors, "attempts": max_retries + 1}
