"""Tool registry.

Adapted from NousResearch/hermes-agent ``tools/registry.py`` (MIT; see
THIRD_PARTY_NOTICES.md). Every tool declares its schema, handler and toolset in
one place, and ``dispatch`` is the only path from a model to a handler. Error
bodies are bounded before they reach model context.

RECALLER adds one rule Hermes has no reason to need: a tool whose name says it
decides or computes a credit outcome cannot be registered at all. Models read
and explain; the credit and policy engines decide, and no agent is ever handed
a path into them.
"""

from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

MAX_TOOL_ERROR_CHARS = 2048  # Hermes: _MAX_TOOL_ERROR_CHARS
_TRUNCATION_MARKER = "… [truncated]"

_FORBIDDEN_TOKENS = {
    "approve",
    "reject",
    "refer",
    "decide",
    "override",
    "sanction",
    "disburse",
    "calculate",
    "compute",
    "emi",
    "foir",
    "ltv",
}


def is_forbidden_tool_name(name: str) -> bool:
    """True for any name an agent must never be given: ``approve_loan``, ``compute_foir``, ``set_policy``…"""
    tokens = re.split(r"[^a-z0-9]+", str(name).lower())
    return any(t in _FORBIDDEN_TOKENS for t in tokens) or bool(re.search(r"set_?policy", str(name), re.I))


def _bound(text: str) -> str:
    return text if len(text) <= MAX_TOOL_ERROR_CHARS else text[:MAX_TOOL_ERROR_CHARS] + _TRUNCATION_MARKER


def tool_error(message: Any) -> str:
    """A tool result reporting failure, in the shape models are shown."""
    return json.dumps({"error": _bound(str(message))}, ensure_ascii=False)


@dataclass(frozen=True)
class Tool:
    name: str
    toolset: str
    description: str
    parameters: Dict[str, Any]
    handler: Callable[..., Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, Tool] = {}

    def register(
        self,
        name: str,
        handler: Callable[..., Any],
        *,
        toolset: str = "",
        description: str = "",
        parameters: Optional[Dict[str, Any]] = None,
    ) -> "ToolRegistry":
        if not name or not callable(handler):
            raise TypeError("A tool needs a name and a callable handler.")
        if is_forbidden_tool_name(name):
            raise ValueError(
                f'Refusing to register "{name}": agents never get tools that decide or compute credit outcomes.'
            )
        if name in self._tools:
            raise ValueError(f'Tool "{name}" is already registered.')
        self._tools[name] = Tool(
            name=name,
            toolset=toolset,
            description=description,
            parameters=parameters or {"type": "object", "properties": {}},
            handler=handler,
        )
        return self

    def has(self, name: str) -> bool:
        return name in self._tools

    def names(self, toolset: Optional[str] = None) -> List[str]:
        return [t.name for t in self._tools.values() if toolset is None or t.toolset == toolset]

    def definitions(self, names: List[str]) -> List[Dict[str, Any]]:
        """Model-facing definitions (Anthropic ``input_schema`` shape) for exactly these names."""
        return [
            {"name": t.name, "description": t.description, "input_schema": t.parameters}
            for t in (self._tools[n] for n in names if n in self._tools)
        ]

    async def dispatch(self, name: str, args: Optional[Dict[str, Any]], context: Optional[Dict[str, Any]] = None) -> str:
        """Run a tool. Always returns a string; a raised handler becomes a bounded error result."""
        tool = self._tools.get(name)
        if tool is None:
            return tool_error(f'Unknown tool "{name}".')
        try:
            params = inspect.signature(tool.handler).parameters
            out = tool.handler(args or {}, context or {}) if len(params) >= 2 else tool.handler(args or {})
            if inspect.isawaitable(out):
                out = await out
        except Exception as exc:  # the model sees the failure; the run continues
            return tool_error(exc)
        return out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, default=str)
