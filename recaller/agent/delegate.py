"""RECALLER agent runtime — delegation to isolated child agents."""

import asyncio
import json
from typing import Any, Callable, Dict, List, Optional
from .loop import DEFAULT_MAX_ITERATIONS, run_agent
from .registry import ToolRegistry
from .structured import check_schema

DELEGATE_BLOCKED_TOOLS = ["delegate_task"]
DEFAULT_MAX_DEPTH = 1
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
                    "goal": {
                        "type": "string",
                        "description": "What this child should accomplish. Self-contained: it knows nothing of your conversation.",
                    },
                    "context": {
                        "type": "string",
                        "description": "Everything this child needs: evidence excerpts, constraints. Children share nothing.",
                    },
                    "output_schema": {
                        "type": "object",
                        "description": "Optional JSON Schema the final answer must satisfy (one correction retry).",
                    },
                },
                "required": ["goal"],
            },
        }
    },
    "required": ["tasks"],
}


def build_child_system_prompt(task: Dict[str, Any], prefix: str = "") -> str:
    parts = [
        prefix.strip(),
        "You are a focused sub-agent inside RECALLER. You know nothing of the parent run beyond what is written here.",
        f"Goal: {task.get('goal')}",
    ]
    if task.get("context"):
        parts.append(f"Context:\n{task['context']}")
    if task.get("output_schema"):
        parts.append(
            f"Your final reply must be only JSON matching this schema:\n{json.dumps(task['output_schema'])}"
        )
    else:
        parts.append(
            "Finish with a concise summary of what you found. It is a self-report; the parent will verify it."
        )
    return "\n\n".join(p for p in parts if p)


def register_delegate_tool(registry: ToolRegistry, options: Optional[Dict[str, Any]] = None) -> ToolRegistry:
    opts = options or {}
    model = opts.get("model")

    async def handle_delegate(args: Dict[str, Any], context: Dict[str, Any]) -> Any:
        return await delegate_task(
            tasks=args.get("tasks", []),
            model=model,
            registry=registry,
            parent=context,
        )

    return registry.register(
        name="delegate_task",
        toolset="delegation",
        description="Spawn isolated sub-agents for reasoning-heavy subtasks; only their final summaries return.",
        parameters=DELEGATE_TASK_SCHEMA,
        handler=handle_delegate,
    )


async def delegate_task(
    tasks: List[Dict[str, Any]],
    model: Callable[..., Any],
    registry: ToolRegistry,
    parent: Optional[Dict[str, Any]] = None,
    max_depth: int = DEFAULT_MAX_DEPTH,
    max_children: int = DEFAULT_MAX_CHILDREN,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    system_prefix: str = "",
) -> Dict[str, Any]:
    p = parent or {}
    depth = p.get("depth", 0)
    if depth >= max_depth:
        return {"error": f"Delegation depth limit reached (depth={depth}, max={max_depth})."}
    if not isinstance(tasks, list) or len(tasks) == 0 or any(not t.get("goal") for t in tasks):
        return {"error": "delegate_task needs at least one task, and every task needs a goal."}
    if len(tasks) > max_children:
        return {"error": f"At most {max_children} tasks per call."}

    child_depth = depth + 1
    blocked = DELEGATE_BLOCKED_TOOLS if child_depth >= max_depth else []
    parent_tools = p.get("toolNames", [])
    child_tools = [n for n in parent_tools if n not in blocked]

    results = []
    for idx, task in enumerate(tasks):
        res = await run_child(
            index=idx,
            task=task,
            model=model,
            registry=registry,
            tool_names=child_tools,
            depth=child_depth,
            max_iterations=max_iterations,
            system_prefix=system_prefix,
        )
        results.append(res)

    return {"results": results}


async def run_child(
    index: int,
    task: Dict[str, Any],
    model: Callable[..., Any],
    registry: ToolRegistry,
    tool_names: List[str],
    depth: int,
    max_iterations: int,
    system_prefix: str,
) -> Dict[str, Any]:
    system = build_child_system_prompt(task, system_prefix)
    entry: Dict[str, Any] = {"task_index": index, "goal": task["goal"]}
    try:
        run = await run_agent(
            model=model,
            registry=registry,
            tool_names=tool_names,
            system=system,
            messages=[{"role": "user", "content": task["goal"]}],
            max_iterations=max_iterations,
            context={"depth": depth},
        )
        entry.update(
            {
                "status": "completed" if run["exitReason"] == "completed" else "failed",
                "exit_reason": run["exitReason"],
                "summary": run["content"],
                "tool_calls": len(run["toolCalls"]),
            }
        )
        output_schema = task.get("output_schema")
        if not output_schema:
            return entry

        chk = check_schema(run["content"], output_schema)
        if not chk["valid"] and run["exitReason"] == "completed":
            retry = await run_agent(
                model=model,
                registry=registry,
                tool_names=[],
                system=system,
                messages=[
                    *run["messages"],
                    {
                        "role": "user",
                        "content": f"Your final answer did not match the required schema:\n- {'\n- '.join(chk['errors'])}\nReply again with only the corrected JSON.",
                    },
                ],
                max_iterations=1,
                context={"depth": depth},
            )
            entry["summary"] = retry["content"]
            chk = check_schema(retry["content"], output_schema)

        entry["schema_valid"] = chk["valid"]
        if chk["valid"]:
            entry["output"] = chk["value"]
        else:
            entry["schema_errors"] = chk["errors"]
        return entry
    except Exception as err:
        return {
            **entry,
            "status": "failed",
            "exit_reason": "error",
            "summary": str(err),
        }
