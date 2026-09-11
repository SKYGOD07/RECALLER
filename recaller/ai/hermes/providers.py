"""Model providers for the Hermes loop.

``AnthropicProvider`` calls the Claude Messages API through the official
``anthropic`` SDK, using a manual tool loop (see ``loop.py``) and Instructor for
structured output. ``ScriptedProvider`` plays back fixed replies, so tests and
offline demos run without a network or a key.

Selection (``provider_from_env``):
  RECALLER_LLM_PROVIDER=auto        Anthropic if ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set, else none
  RECALLER_LLM_PROVIDER=anthropic   always Anthropic (also works with an `ant auth login` profile)
  RECALLER_LLM_PROVIDER=none        no model; RECALLER runs fully deterministic
  RECALLER_LLM_MODEL                default claude-opus-5
  RECALLER_LLM_EFFORT               optional low | medium | high | xhigh | max
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Type, TypeVar

from pydantic import BaseModel

from .structured import generate_structured

DEFAULT_ANTHROPIC_MODEL = "claude-opus-5"
_FALLBACK_BETA = "server-side-fallback-2026-07-01"

M = TypeVar("M", bound=BaseModel)


@dataclass
class ModelReply:
    content: str = ""
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    stop_reason: Optional[str] = None
    provider_content: Any = None
    usage: Dict[str, int] = field(default_factory=dict)
    request_id: Optional[str] = None


class ProviderError(RuntimeError):
    """A model call failed. ``status`` mirrors the upstream HTTP status where there was one."""

    def __init__(self, message: str, *, status: Optional[int] = None, retryable: bool = False) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        model: str = DEFAULT_ANTHROPIC_MODEL,
        *,
        max_tokens: int = 16000,
        effort: Optional[str] = None,
        timeout: float = 180.0,
    ) -> None:
        import anthropic

        self._sdk = anthropic
        self.client = anthropic.AsyncAnthropic(timeout=timeout, max_retries=2)
        self.model = model
        self.max_tokens = max_tokens
        self.effort = effort

    # -- transcript → Messages API ------------------------------------------------

    @staticmethod
    def to_api_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Neutral transcript → Messages API. Consecutive tool results go back in ONE user message."""
        out: List[Dict[str, Any]] = []
        results: List[Dict[str, Any]] = []

        def flush() -> None:
            if results:
                out.append({"role": "user", "content": list(results)})
                results.clear()

        for m in messages:
            role = m.get("role")
            if role == "tool":
                block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m.get("content", "")}
                if m.get("is_error"):
                    block["is_error"] = True
                results.append(block)
                continue
            flush()
            if role == "assistant":
                content = m.get("provider_content")
                if content is None:  # built locally (e.g. tests): reconstruct the blocks
                    content = [{"type": "text", "text": m["content"]}] if m.get("content") else []
                    content += [
                        {"type": "tool_use", "id": c["id"], "name": c["name"], "input": c.get("arguments") or {}}
                        for c in m.get("tool_calls", [])
                    ]
                out.append({"role": "assistant", "content": content or m.get("content", "")})
            else:
                out.append({"role": "user", "content": m.get("content", "")})
        flush()
        return out

    def _request_options(self) -> Dict[str, Any]:
        opts: Dict[str, Any] = {
            # Server-side refusal fallback, routed by refusal category (Claude Opus 5 default).
            "extra_headers": {"anthropic-beta": _FALLBACK_BETA},
            "extra_body": {"fallbacks": "default"},
        }
        if self.effort:
            opts["output_config"] = {"effort": self.effort}
        return opts

    async def complete(self, *, system: str, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> ModelReply:
        sdk = self._sdk
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": self.to_api_messages(messages),
            **self._request_options(),
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = tools
        try:
            resp = await self.client.messages.create(**kwargs)
        except sdk.AuthenticationError as exc:
            raise ProviderError("Anthropic rejected the credentials.", status=401) from exc
        except sdk.PermissionDeniedError as exc:
            raise ProviderError("The Anthropic key lacks permission for this model.", status=403) from exc
        except sdk.NotFoundError as exc:
            raise ProviderError(f"Unknown model or endpoint: {self.model}.", status=404) from exc
        except sdk.RateLimitError as exc:
            raise ProviderError("Rate limited by Anthropic; retry shortly.", status=429, retryable=True) from exc
        except sdk.BadRequestError as exc:
            raise ProviderError(f"Anthropic rejected the request: {exc.message}", status=400) from exc
        except sdk.APIStatusError as exc:
            raise ProviderError(f"Anthropic error {exc.status_code}.", status=exc.status_code, retryable=exc.status_code >= 500) from exc
        except sdk.APIConnectionError as exc:
            raise ProviderError("Could not reach the Anthropic API.", retryable=True) from exc

        return ModelReply(
            content="".join(b.text for b in resp.content if b.type == "text"),
            tool_calls=[{"id": b.id, "name": b.name, "arguments": b.input} for b in resp.content if b.type == "tool_use"],
            stop_reason=resp.stop_reason,
            provider_content=[b.model_dump(mode="json", exclude_none=True) for b in resp.content],
            usage={"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens},
            request_id=getattr(resp, "_request_id", None),
        )

    async def structured(self, *, response_model: Type[M], system: str, prompt: str, max_retries: int = 2) -> M:
        """Instructor over the Anthropic SDK. JSON mode, because forced tool choice conflicts with adaptive thinking."""
        import instructor

        client = instructor.from_anthropic(self.client, mode=instructor.Mode.ANTHROPIC_JSON)
        try:
            return await client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                response_model=response_model,
                max_retries=max_retries,
            )
        except Exception as exc:
            raise ProviderError(f"Structured output failed: {exc}") from exc


class ScriptedProvider:
    """Plays back replies in order. A reply may be a dict, a ``ModelReply`` or ``fn(request) -> reply``."""

    name = "scripted"
    model = "scripted"

    def __init__(self, replies: List[Any]) -> None:
        self.replies = list(replies)
        self.calls: List[Dict[str, Any]] = []
        self._i = 0

    async def complete(self, *, system: str, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> ModelReply:
        request = {"system": system, "messages": [dict(m) for m in messages], "tools": tools}
        self.calls.append(request)
        reply = self.replies[min(self._i, len(self.replies) - 1)]
        self._i += 1
        if callable(reply):
            reply = reply(request)
        if isinstance(reply, ModelReply):
            return reply
        return ModelReply(
            content=reply.get("content", ""),
            tool_calls=reply.get("tool_calls", []),
            stop_reason=reply.get("stop_reason", "tool_use" if reply.get("tool_calls") else "end_turn"),
        )


async def structured(provider: Any, *, response_model: Type[M], system: str, prompt: str, max_retries: int = 2) -> M:
    """Use the provider's native Instructor path when it has one, else the provider-agnostic loop."""
    native: Optional[Callable[..., Any]] = getattr(provider, "structured", None)
    if native is not None:
        return await native(response_model=response_model, system=system, prompt=prompt, max_retries=max_retries)
    value, errors, _ = await generate_structured(
        provider=provider, response_model=response_model, system=system, prompt=prompt, max_retries=max_retries
    )
    if value is None:
        raise ProviderError("Structured output failed validation: " + "; ".join(errors))
    return value


def provider_status(env: Mapping[str, str] = os.environ) -> Dict[str, Any]:
    mode = (env.get("RECALLER_LLM_PROVIDER") or "auto").strip().lower()
    has_creds = bool(env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN"))
    enabled = mode == "anthropic" or (mode == "auto" and has_creds)
    return {
        "mode": mode,
        "provider": "anthropic" if enabled else None,
        "model": (env.get("RECALLER_LLM_MODEL") or DEFAULT_ANTHROPIC_MODEL) if enabled else None,
        "effort": env.get("RECALLER_LLM_EFFORT") or None,
        "credentials_detected": has_creds,
        "enabled": enabled,
    }


def provider_from_env(env: Mapping[str, str] = os.environ) -> Optional[AnthropicProvider]:
    status = provider_status(env)
    if not status["enabled"]:
        return None
    return AnthropicProvider(model=status["model"], effort=status["effort"])
