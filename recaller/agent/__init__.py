"""RECALLER - Agent Runtime."""

from .adapters.extraction import create_agent_extraction_adapter
from .adapters.narration import create_narration_stylist
from .delegate import (
    DELEGATE_BLOCKED_TOOLS,
    DELEGATE_TASK_SCHEMA,
    build_child_system_prompt,
    delegate_task,
    register_delegate_tool,
)
from .loop import DEFAULT_MAX_ITERATIONS, run_agent
from .registry import ToolRegistry, create_registry, is_forbidden_tool_name, tool_error
from .skills import parse_skill, skill_prompt
from .structured import (
    check_schema,
    generate_structured,
    parse_json_reply,
    validate,
)
from .toolsets import TOOLSETS, resolve_toolset, resolve_toolsets

__all__ = [
    "ToolRegistry",
    "create_registry",
    "is_forbidden_tool_name",
    "tool_error",
    "TOOLSETS",
    "resolve_toolset",
    "resolve_toolsets",
    "DEFAULT_MAX_ITERATIONS",
    "run_agent",
    "validate",
    "parse_json_reply",
    "check_schema",
    "generate_structured",
    "parse_skill",
    "skill_prompt",
    "DELEGATE_BLOCKED_TOOLS",
    "DELEGATE_TASK_SCHEMA",
    "build_child_system_prompt",
    "register_delegate_tool",
    "delegate_task",
    "create_agent_extraction_adapter",
    "create_narration_stylist",
]
