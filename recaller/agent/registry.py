"""RECALLER agent runtime — tool registry with safety and bounding."""

import inspect
import json
import re
from typing import Any, Callable, Dict, List, Optional, Set

MAX_TOOL_ERROR_CHARS = 2048
TRUNCATION_MARKER = "… [truncated]"

FORBIDDEN_TOKENS = {
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
    tokens = re.split(r"[^a-z0-9]+", str(name).lower())
    if any(t in FORBIDDEN_TOKENS for t in tokens):
        return True
    if re.search(r"set_?policy", str(name), re.IGNORECASE):
        return True
    return False


def bound_text(text: str) -> str:
    if len(text) <= MAX_TOOL_ERROR_CHARS:
        return text
    return text[:MAX_TOOL_ERROR_CHARS] + TRUNCATION_MARKER


def tool_error(message: Any) -> str:
    return json.dumps({"error": bound_text(str(message))})


class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, Dict[str, Any]] = {}

    def register(
        self,
        name: str,
        handler: Callable[..., Any],
        toolset: Optional[str] = None,
        description: str = "",
        parameters: Optional[Dict[str, Any]] = None,
    ) -> "ToolRegistry":
        if not name or not callable(handler):
            raise TypeError("A tool needs a name and a handler.")
        if is_forbidden_tool_name(name):
            raise ValueError(
                f'Refusing to register "{name}": agents never get tools that decide or compute credit outcomes.'
            )
        if name in self.tools:
            raise ValueError(f'Tool "{name}" is already registered.')
        self.tools[name] = {
            "name": name,
            "toolset": toolset,
            "description": description,
            "parameters": parameters or {"type": "object", "properties": {}},
            "handler": handler,
        }
        return self

    def has(self, name: str) -> bool:
        return name in self.tools

    def names(self, toolset: Optional[str] = None) -> List[str]:
        return [
            t["name"]
            for t in self.tools.values()
            if not toolset or t.get("toolset") == toolset
        ]

    def definitions(self, names: List[str]) -> List[Dict[str, Any]]:
        return [
            {
                "name": self.tools[n]["name"],
                "description": self.tools[n]["description"],
                "parameters": self.tools[n]["parameters"],
            }
            for n in names
            if n in self.tools
        ]

    async def dispatch(
        self,
        name: str,
        args: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        tool = self.tools.get(name)
        if not tool:
            return tool_error(f'Unknown tool "{name}".')
        try:
            handler = tool["handler"]
            params = inspect.signature(handler).parameters
            if len(params) >= 2:
                out = handler(args or {}, context or {})
            elif len(params) == 1:
                out = handler(args or {})
            else:
                out = handler()

            if inspect.isawaitable(out):
                out = await out

            return out if isinstance(out, str) else json.dumps(out if out is not None else None)
        except Exception as err:
            return tool_error(str(err))


def create_registry() -> ToolRegistry:
    return ToolRegistry()
