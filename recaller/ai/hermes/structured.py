"""Validated structured output.

The pattern of the Hermes ``instructor`` skill (MIT; the skill itself ships in
``skills/instructor``): declare a Pydantic model, parse the reply, validate it,
and on failure hand the validation errors back for a bounded number of
corrections. Providers that support the ``instructor`` library use it directly
(see ``providers.AnthropicProvider.structured``); this module is the
provider-agnostic path and the parser used by delegation.

Validation constrains shape and range. It cannot make a value true: grounding
(``adapter.py``), reconciliation and the confidence gate do that.
"""

from __future__ import annotations

import json
import re
from typing import Any, List, Optional, Tuple, Type, TypeVar

from pydantic import BaseModel, ValidationError

M = TypeVar("M", bound=BaseModel)


def parse_json_reply(text: str) -> Tuple[bool, Any, Optional[str]]:
    """Pull a JSON value out of a reply, tolerating ``` fences and surrounding prose."""
    raw = str(text or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    body = fenced.group(1).strip() if fenced else raw
    starts = [i for i in (body.find("{"), body.find("[")) if i != -1]
    if not starts:
        return False, None, "no JSON object or array found"
    start = min(starts)
    end = max(body.rfind("}"), body.rfind("]"))
    try:
        return True, json.loads(body[start : end + 1]), None
    except ValueError as exc:
        return False, None, str(exc)


def validation_errors(exc: ValidationError) -> List[str]:
    return [f"{'.'.join(str(p) for p in e['loc']) or '$'}: {e['msg']}" for e in exc.errors()]


def validate_reply(text: str, model: Type[M]) -> Tuple[Optional[M], List[str]]:
    ok, value, err = parse_json_reply(text)
    if not ok:
        return None, [f"not valid JSON: {err}"]
    try:
        return model.model_validate(value), []
    except ValidationError as exc:
        return None, validation_errors(exc)


def schema_instruction(model: Type[BaseModel]) -> str:
    return "Reply with only JSON matching this schema:\n" + json.dumps(model.model_json_schema())


async def generate_structured(
    *,
    provider: Any,
    response_model: Type[M],
    system: str,
    prompt: str,
    max_retries: int = 2,
) -> Tuple[Optional[M], List[str], int]:
    """Provider-agnostic Instructor loop: returns (value | None, errors, attempts)."""
    messages: List[dict] = [{"role": "user", "content": f"{prompt}\n\n{schema_instruction(response_model)}"}]
    errors: List[str] = []
    for attempt in range(1, max_retries + 2):
        reply = await provider.complete(system=system, messages=messages, tools=[])
        value, errors = validate_reply(reply.content, response_model)
        if value is not None:
            return value, [], attempt
        messages.append({"role": "assistant", "content": reply.content, "provider_content": reply.provider_content})
        messages.append(
            {"role": "user", "content": "That reply failed validation:\n- " + "\n- ".join(errors) + "\nReturn the corrected JSON only."}
        )
    return None, errors, max_retries + 1
