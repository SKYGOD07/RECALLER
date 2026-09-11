"""RECALLER — narration stylist adapter."""

import inspect
from typing import Any, Callable

INSTRUCTIONS = (
    "Rewrite the credit-memo paragraph you are given for a credit committee: clear, formal and concise. "
    "Keep every number, amount, percentage and code exactly as written. Add no facts. Reply with the paragraph only."
)


def create_narration_stylist(model: Callable[..., Any], skill_prompt: str = ""):
    if not callable(model):
        raise TypeError("create_narration_stylist needs a model function.")

    async def stylist(text: str) -> str:
        system = "\n\n".join(p for p in [skill_prompt.strip(), INSTRUCTIONS] if p)
        req = {
            "system": system,
            "messages": [{"role": "user", "content": str(text)}],
            "tools": [],
        }
        reply = model(req)
        if inspect.isawaitable(reply):
            reply = await reply
        out = str(reply.get("content", "") if isinstance(reply, dict) else "").strip()
        if not out:
            raise ValueError("The stylist returned an empty rewrite.")
        return out

    return stylist
