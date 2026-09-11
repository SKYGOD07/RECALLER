"""``delegate_task`` — isolated child agents.

Adapted from NousResearch/hermes-agent ``tools/delegate_tool.py`` (MIT). Kept
from its contract:
  - each child gets a fresh conversation and a focused system prompt built
    from its goal and context; it knows nothing else of the parent's run;
  - children inherit the parent's tools minus ``DELEGATE_BLOCKED_TOOLS``;
  - nesting is bounded by depth (a child may delegate only while depth remains);
  - the parent sees only each child's final summary, never its tool calls;
  - an optional output schema is validated with one bounded correction retry.

Dropped: sessions, terminals, heartbeats, background dispatch and credential
pools. A credit file is processed synchronously, in one place. Children run
concurrently, up to ``max_children`` per call.

Child summaries are self-reports. Nothing a child returns enters the evidence
set; review findings are advisory and are stored beside the record, not in it.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel

from .loop import DEFAULT_MAX_ITERATIONS, run_agent
from .registry import ToolRegistry
from .structured import schema_instruction, validate_reply

DELEGATE_BLOCKED_TOOLS = ["delegate_task"]
DEFAULT_MAX_DEPTH = 1  # the top-level agent may delegate; its children are leaves
DEFAULT_MAX_CHILDREN = 4

DELEGATE_TASK_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string", "description": "What this child should accomplish. Self-contained."},
                    "context": {"type": "string", "description": "Everything this child needs. Children share nothing."},
                },
                "required": ["goal"],
            },
        }
    },
    "required": ["tasks"],
}


def build_child_system_prompt(goal: str, context: Optional[str], prefix: str = "", output_model: Optional[Type[BaseModel]] = None) -> str:
    parts = [
        prefix.strip(),
        "You are a focused sub-agent inside RECALLER. You know nothing of the parent run beyond what is written here.",
        f"Goal: {goal}",
        f"Context:\n{context}" if context else "",
        schema_instruction(output_model)
        if output_model
        else "Finish with a concise summary of what you found. It is a self-report; the parent will verify it.",
    ]
    return "\n\n".join(p for p in parts if p)


async def delegate_task(
    *,
    tasks: List[Dict[str, Any]],
    provider: Any,
    registry: ToolRegistry,
    parent: Optional[Dict[str, Any]] = None,
    output_model: Optional[Type[BaseModel]] = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
    max_children: int = DEFAULT_MAX_CHILDREN,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    system_prefix: str = "",
) -> Dict[str, Any]:
    parent = parent or {}
    depth = int(parent.get("depth", 0))
    if depth >= max_depth:
        return {"error": f"Delegation depth limit reached (depth={depth}, max={max_depth})."}
    if not tasks or any(not t.get("goal") for t in tasks):
        return {"error": "delegate_task needs at least one task, and every task needs a goal."}
    if len(tasks) > max_children:
        return {"error": f"At most {max_children} tasks per call."}

    child_depth = depth + 1
    blocked = DELEGATE_BLOCKED_TOOLS if child_depth >= max_depth else []
    tool_names = [n for n in parent.get("tool_names", []) if n not in blocked]

    results = await asyncio.gather(
        *(
            _run_child(i, t, provider, registry, tool_names, child_depth, max_iterations, system_prefix, output_model)
            for i, t in enumerate(tasks)
        )
    )
    return {"results": list(results)}


async def _run_child(index, task, provider, registry, tool_names, depth, max_iterations, prefix, output_model):
    system = build_child_system_prompt(task["goal"], task.get("context"), prefix, output_model)
    entry: Dict[str, Any] = {"task_index": index, "goal": task["goal"]}
    try:
        run = await run_agent(
            provider=provider,
            registry=registry,
            tool_names=tool_names,
            system=system,
            messages=[{"role": "user", "content": task["goal"]}],
            max_iterations=max_iterations,
            context={"depth": depth, **(task.get("context_data") or {})},
        )
        entry.update(
            status="completed" if run.exit_reason == "completed" else "failed",
            exit_reason=run.exit_reason,
            summary=run.content,
            tool_calls=len(run.tool_calls),
            usage=run.usage,
        )
        if output_model is None:
            return entry

        value, errors = validate_reply(run.content, output_model)
        if value is None and run.exit_reason == "completed":
            retry = await run_agent(
                provider=provider,
                registry=registry,
                tool_names=[],  # a correction is a rewrite, not more work
                system=system,
                messages=[
                    *run.messages,
                    {"role": "user", "content": "Your final answer did not match the schema:\n- " + "\n- ".join(errors) + "\nReply with only the corrected JSON."},
                ],
                max_iterations=1,
                context={"depth": depth},
            )
            entry["summary"] = retry.content
            value, errors = validate_reply(retry.content, output_model)
        entry["schema_valid"] = value is not None
        if value is not None:
            entry["output"] = json.loads(value.model_dump_json())
        else:
            entry["schema_errors"] = errors
        return entry
    except Exception as exc:  # a failed child is reported, never raised into the parent
        return {**entry, "status": "failed", "exit_reason": "error", "summary": str(exc)}


def register_delegate_tool(registry: ToolRegistry, *, provider: Any, **options: Any) -> ToolRegistry:
    """Expose ``delegate_task`` to a model; parent depth and tools arrive via the loop's context."""

    async def handler(args: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        return await delegate_task(tasks=args.get("tasks") or [], provider=provider, registry=registry, parent=context, **options)

    return registry.register(
        "delegate_task",
        handler,
        toolset="delegation",
        description=(
            "Spawn isolated sub-agents for reasoning-heavy subtasks; only their final summaries return. "
            "Pass everything a child needs in its context. Summaries are self-reports, not verified facts."
        ),
        parameters=DELEGATE_TASK_SCHEMA,
    )
