"""RECALLER agent runtime — conversation loop."""

import asyncio
import inspect
import json
from typing import Any, Callable, Dict, List, Optional
from .registry import ToolRegistry, tool_error

DEFAULT_MAX_ITERATIONS = 12


def normalise_calls(calls: Any) -> List[Dict[str, Any]]:
    if not isinstance(calls, list):
        return []
    out = []
    for i, c in enumerate(calls):
        if isinstance(c, dict) and c.get("name"):
            out.append(
                {
                    "id": c.get("id", f"call_{i}"),
                    "name": str(c.get("name")),
                    "arguments": c.get("arguments", {}),
                }
            )
    return out


def parse_args(raw: Any) -> Any:
    if isinstance(raw, dict):
        return raw
    if raw is None or raw == "":
        return {}
    try:
        parsed = json.loads(str(raw))
        return parsed if isinstance(parsed, dict) else ValueError("expected a JSON object")
    except Exception as err:
        return err


def emit(on_event: Optional[Callable[[Dict[str, Any]], None]], event: Dict[str, Any]) -> None:
    if callable(on_event):
        try:
            on_event(event)
        except Exception:
            pass


async def run_agent(
    model: Callable[..., Any],
    registry: ToolRegistry,
    tool_names: Optional[List[str]] = None,
    system: str = "",
    messages: Optional[List[Dict[str, Any]]] = None,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    context: Optional[Dict[str, Any]] = None,
    on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Run model tool-use conversation loop."""
    if not callable(model):
        raise TypeError("run_agent needs a model function.")

    allowed = set(t for t in (tool_names or []) if registry.has(t))
    tools = registry.definitions(list(allowed))
    transcript = list(messages or [])
    tool_calls_history = []
    ctx = context or {}

    for iteration in range(1, max_iterations + 1):
        req = {"system": system, "messages": list(transcript), "tools": tools}
        reply = model(req)
        if inspect.isawaitable(reply):
            reply = await reply

        calls = normalise_calls(reply.get("tool_calls") if isinstance(reply, dict) else None)
        content = reply.get("content", "") if isinstance(reply, dict) else ""

        assistant_msg: Dict[str, Any] = {"role": "assistant", "content": content}
        if calls:
            assistant_msg["tool_calls"] = calls
        transcript.append(assistant_msg)

        if not calls:
            emit(on_event, {"type": "final", "iteration": iteration})
            return {
                "content": content,
                "messages": transcript,
                "toolCalls": tool_calls_history,
                "iterations": iteration,
                "exitReason": "completed",
            }

        for c in calls:
            call_name = c["name"]
            call_args = c["arguments"]
            call_id = c["id"]

            if call_name not in allowed:
                valid_str = ", ".join(sorted(allowed)) if allowed else "none"
                result = tool_error(
                    f'Tool "{call_name}" is not available to this agent. Available tools: {valid_str}.'
                )
            else:
                args = parse_args(call_args)
                if isinstance(args, Exception):
                    result = tool_error(f'Arguments for "{call_name}" are not valid JSON: {args}')
                else:
                    dispatch_ctx = {**ctx, "toolNames": list(allowed)}
                    result = await registry.dispatch(call_name, args, dispatch_ctx)

            tool_calls_history.append({"name": call_name, "arguments": call_args, "result": result})
            transcript.append({"role": "tool", "tool_call_id": call_id, "name": call_name, "content": result})
            emit(on_event, {"type": "tool", "iteration": iteration, "name": call_name})

    emit(on_event, {"type": "max_iterations", "iteration": max_iterations})
    return {
        "content": "",
        "messages": transcript,
        "toolCalls": tool_calls_history,
        "iterations": max_iterations,
        "exitReason": "max_iterations",
    }
