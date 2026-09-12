"""RECALLER's agent layer, built on patterns from Hermes Agent (MIT; see THIRD_PARTY_NOTICES.md).

Invariant: nothing in this package imports the credit engine, the policy
engine or the what-if solver, and the registry refuses any tool that decides or
computes a credit outcome. tests/test_hermes.py asserts both.
"""

from .adapter import AgentExtractionAdapter, allowed_numbers, ask_about_file, explain_decision, extract_draft_application, review_file, unsupported_numbers
from .delegation import DELEGATE_BLOCKED_TOOLS, delegate_task, register_delegate_tool
from .loop import DEFAULT_MAX_ITERATIONS, AgentRun, run_agent
from .providers import (
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_OLLAMA_HOST,
    DEFAULT_OLLAMA_MODEL,
    OLLAMA_CLOUD_HOST,
    AnthropicProvider,
    ModelReply,
    OllamaProvider,
    ProviderError,
    ScriptedProvider,
    check_provider,
    provider_from_env,
    provider_status,
    structured,
)
from .registry import ToolRegistry, is_forbidden_tool_name, tool_error
from .skills import list_skills, load_skill, parse_skill, skill_prompt
from .structured import generate_structured, parse_json_reply, validate_reply
from .toolsets import TOOLSETS, resolve_toolset, resolve_toolsets

__all__ = [
    "AgentExtractionAdapter",
    "AgentRun",
    "AnthropicProvider",
    "DEFAULT_ANTHROPIC_MODEL",
    "DEFAULT_MAX_ITERATIONS",
    "DEFAULT_OLLAMA_HOST",
    "DEFAULT_OLLAMA_MODEL",
    "DELEGATE_BLOCKED_TOOLS",
    "OLLAMA_CLOUD_HOST",
    "ModelReply",
    "OllamaProvider",
    "ProviderError",
    "ScriptedProvider",
    "TOOLSETS",
    "ToolRegistry",
    "allowed_numbers",
    "ask_about_file",
    "check_provider",
    "delegate_task",
    "explain_decision",
    "extract_draft_application",
    "generate_structured",
    "is_forbidden_tool_name",
    "list_skills",
    "load_skill",
    "parse_json_reply",
    "parse_skill",
    "provider_from_env",
    "provider_status",
    "register_delegate_tool",
    "resolve_toolset",
    "resolve_toolsets",
    "review_file",
    "run_agent",
    "skill_prompt",
    "structured",
    "tool_error",
    "unsupported_numbers",
    "validate_reply",
]
