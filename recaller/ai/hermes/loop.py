"""The agent loop.

Adapted from NousResearch/hermes-agent ``agent/conversation_loop.py`` and the
``AIAgent`` facade in ``run_agent.py`` (MIT). Kept: call the model, dispatch any
tool calls through the registry, feed the results back, repeat until the model
answers in plain text or the iteration budget runs out. An unknown or
unavailable tool is answered with an error naming the valid tools, never
executed. The exit reason is ``completed``, ``max_iterations`` or ``refusal``.

Dropped: context compression, prompt caching and provider fallback plumbing. A
credit file is small and bounded, and the provider sits behind the
``Provider`` interface in ``providers.py``.

The transcript is provider-neutral:
  {"role": "user", "content": str}
  {"role": "assistant", "content": str, "tool_calls": [...], "provider_content": <raw blocks>}
  {"role": "tool", "tool_call_id": str, "name": str, "content": str, "is_error": bool}
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .registry import ToolRegistry, tool_error

DEFAULT_MAX_ITERATIONS = 12


@dataclass
class AgentRun:
    content: str
    messages: List[Dict[str, Any]]
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    iterations: int = 0
    exit_reason: str = "completed"
    usage: Dict[str, int] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})


async def run_agent(
    *,
    provider: Any,
    registry: ToolRegistry,
    tool_names: List[str],
    system: str = "",
    messages: Optional[List[Dict[str, Any]]] = None,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    context: Optional[Dict[str, Any]] = None,
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> AgentRun:
    allowed = [n for n in tool_names if registry.has(n)]
    tools = registry.definitions(allowed)
    transcript: List[Dict[str, Any]] = list(messages or [])
    run = AgentRun(content="", messages=transcript)

    for iteration in range(1, max_iterations + 1):
        reply = await provider.complete(system=system, messages=transcript, tools=tools)
        run.iterations = iteration
        for k, v in (reply.usage or {}).items():
            run.usage[k] = run.usage.get(k, 0) + int(v or 0)

        calls = [c for c in (reply.tool_calls or []) if c.get("name")]
        transcript.append(
            {
                "role": "assistant",
                "content": reply.content or "",
                **({"tool_calls": calls} if calls else {}),
                **({"provider_content": reply.provider_content} if reply.provider_content is not None else {}),
            }
        )

        if reply.stop_reason == "refusal":
            run.exit_reason = "refusal"
            _emit(on_event, {"type": "refusal", "iteration": iteration})
            return run

        if not calls:
            run.content = reply.content or ""
            _emit(on_event, {"type": "final", "iteration": iteration})
            return run

        for i, call in enumerate(calls):
            call_id = call.get("id") or f"call_{iteration}_{i}"
            name = str(call["name"])
            if name not in allowed:
                result = tool_error(
                    f'Tool "{name}" is not available to this agent. Available tools: {", ".join(allowed) or "none"}.'
                )
            else:
                args = _parse_args(call.get("arguments"))
                if isinstance(args, Exception):
                    result = tool_error(f'Arguments for "{name}" are not valid JSON: {args}')
                else:
                    result = await registry.dispatch(name, args, {**(context or {}), "tool_names": allowed})
            is_error = result.startswith('{"error"')
            run.tool_calls.append({"name": name, "arguments": call.get("arguments"), "result": result, "is_error": is_error})
            transcript.append({"role": "tool", "tool_call_id": call_id, "name": name, "content": result, "is_error": is_error})
            _emit(on_event, {"type": "tool", "iteration": iteration, "name": name, "is_error": is_error})

    run.exit_reason = "max_iterations"
    _emit(on_event, {"type": "max_iterations", "iteration": max_iterations})
    return run


def _parse_args(raw: Any) -> Any:
    if isinstance(raw, dict):
        return raw
    if raw in (None, ""):
        return {}
    try:
        parsed = json.loads(str(raw))
    except (TypeError, ValueError) as exc:
        return exc
    return parsed if isinstance(parsed, dict) else ValueError("expected a JSON object")


def _emit(on_event: Optional[Callable[[Dict[str, Any]], None]], event: Dict[str, Any]) -> None:
    if on_event is None:
        return
    try:
        on_event(event)
    except Exception:  # an observer must never break a run
        pass
