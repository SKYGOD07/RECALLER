"""Model providers for the Hermes loop.

``AnthropicProvider`` calls the Claude Messages API through the official
``anthropic`` SDK, using a manual tool loop (see ``loop.py``) and Instructor for
structured output. ``OllamaProvider`` calls an Ollama server — local by
default, or Ollama Cloud with a key — over its ``/api/chat`` endpoint, and uses
Ollama's JSON-schema ``format`` for structured output. ``ScriptedProvider``
plays back fixed replies, so tests and offline demos run without a network or a
key.

All three satisfy the same small protocol, which is all the loop needs:

    name, model
    async complete(*, system, messages, tools) -> ModelReply
    async structured(*, response_model, system, prompt, max_retries) -> BaseModel   [optional]

Selection (``provider_from_env``):
  RECALLER_LLM_PROVIDER=auto        Anthropic if ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set,
                                    else Ollama if OLLAMA_HOST / OLLAMA_API_KEY is set, else none
  RECALLER_LLM_PROVIDER=anthropic   always Anthropic (also works with an `ant auth login` profile)
  RECALLER_LLM_PROVIDER=ollama      always Ollama
  RECALLER_LLM_PROVIDER=none        no model; RECALLER runs fully deterministic
  RECALLER_LLM_MODEL                default claude-opus-5 (Anthropic) / llama3.1 (Ollama)
  RECALLER_LLM_EFFORT               Anthropic only: low | medium | high | xhigh | max
  RECALLER_LLM_TEMPERATURE          Ollama only, default 0 — underwriting wants repeatable reads

  OLLAMA_HOST                       default http://127.0.0.1:11434; use https://ollama.com for Cloud
  OLLAMA_API_KEY                    Ollama Cloud key. A local server needs none.

Whichever provider is configured, it only ever reads documents and explains a
finished decision. No provider is reachable from the credit engine, the policy
engine or the what-if solver, and the tool registry refuses any tool that would
decide or compute a credit outcome.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Type, TypeVar, Union

from pydantic import BaseModel

from .structured import generate_structured

DEFAULT_ANTHROPIC_MODEL = "claude-opus-5"
DEFAULT_OLLAMA_MODEL = "llama3.1"
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
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


class OllamaProvider:
    """An Ollama server, local or Ollama Cloud.

    Ollama speaks its own chat API rather than the Messages API, so this class
    owns three translations and nothing else:

      * transcript  → Ollama messages (tool results are their own role)
      * tool schema → Ollama function schema (``input_schema`` → ``parameters``)
      * reply       → ``ModelReply`` (synthesising call ids, which Ollama omits)

    Temperature defaults to 0: the model's jobs here are reading fields off a
    document and restating a decision, and both want the same answer twice.
    """

    name = "ollama"

    def __init__(
        self,
        model: str = DEFAULT_OLLAMA_MODEL,
        *,
        host: str = DEFAULT_OLLAMA_HOST,
        api_key: Optional[str] = None,
        temperature: float = 0.0,
        num_ctx: Optional[int] = None,
        keep_alive: Optional[str] = None,
        timeout: float = 300.0,
    ) -> None:
        self.model = model
        self.host = str(host).rstrip("/")
        self.api_key = api_key or None
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.keep_alive = keep_alive
        self.timeout = timeout

    # -- translation --------------------------------------------------------------

    @staticmethod
    def to_api_messages(system: str, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Neutral transcript → Ollama messages. The system prompt is message zero."""
        out: List[Dict[str, Any]] = []
        if system:
            out.append({"role": "system", "content": system})

        for m in messages:
            role = m.get("role")
            if role == "tool":
                # Ollama takes each tool result as its own message; tool_name lets
                # models that were given several calls at once line them up again.
                out.append(
                    {
                        "role": "tool",
                        "content": str(m.get("content", "")),
                        "tool_name": m.get("name") or "",
                    }
                )
                continue

            if role == "assistant":
                msg: Dict[str, Any] = {"role": "assistant", "content": m.get("content", "") or ""}
                calls = m.get("tool_calls") or []
                if calls:
                    msg["tool_calls"] = [
                        {"function": {"name": c.get("name", ""), "arguments": c.get("arguments") or {}}}
                        for c in calls
                    ]
                out.append(msg)
                continue

            out.append({"role": "user", "content": m.get("content", "") or ""})

        return out

    @staticmethod
    def to_api_tools(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Registry definitions (Anthropic ``input_schema`` shape) → Ollama function schema."""
        return [
            {
                "type": "function",
                "function": {
                    "name": t.get("name", ""),
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema") or {"type": "object", "properties": {}},
                },
            }
            for t in tools
        ]

    def _options(self) -> Dict[str, Any]:
        options: Dict[str, Any] = {"temperature": self.temperature}
        if self.num_ctx:
            options["num_ctx"] = self.num_ctx
        return options

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        import httpx

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.host}{path}", json=body, headers=self._headers())
        except httpx.ConnectError as exc:
            raise ProviderError(
                f"Could not reach the Ollama server at {self.host}. Is it running (ollama serve)?",
                retryable=True,
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError(f"Ollama timed out after {self.timeout:.0f}s.", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Could not reach Ollama: {exc}", retryable=True) from exc

        if resp.status_code >= 400:
            raise ProviderError(_ollama_error(resp, self.model, self.host), status=resp.status_code, retryable=resp.status_code >= 500)

        try:
            payload = resp.json()
        except ValueError as exc:
            raise ProviderError("Ollama returned a body that is not JSON.") from exc
        if not isinstance(payload, dict):
            raise ProviderError("Ollama returned an unexpected body.")
        return payload

    # -- protocol -----------------------------------------------------------------

    async def complete(self, *, system: str, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> ModelReply:
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": self.to_api_messages(system, messages),
            "stream": False,
            "options": self._options(),
        }
        if tools:
            body["tools"] = self.to_api_tools(tools)
        if self.keep_alive:
            body["keep_alive"] = self.keep_alive

        payload = await self._post("/api/chat", body)
        return self._to_reply(payload)

    @staticmethod
    def _to_reply(payload: Dict[str, Any]) -> ModelReply:
        message = payload.get("message") or {}
        raw_calls = message.get("tool_calls") or []

        calls: List[Dict[str, Any]] = []
        for i, call in enumerate(raw_calls):
            fn = call.get("function") or {}
            name = fn.get("name")
            if not name:
                continue
            calls.append({"id": call.get("id") or f"ollama_{i}", "name": name, "arguments": fn.get("arguments") or {}})

        return ModelReply(
            content=str(message.get("content") or ""),
            tool_calls=calls,
            # The loop only distinguishes "there are tool calls" from "there are not";
            # done_reason is carried through for anything that wants the detail.
            stop_reason="tool_use" if calls else (payload.get("done_reason") or "end_turn"),
            provider_content=message or None,
            usage={
                "input_tokens": int(payload.get("prompt_eval_count") or 0),
                "output_tokens": int(payload.get("eval_count") or 0),
            },
        )

    async def structured(self, *, response_model: Type[M], system: str, prompt: str, max_retries: int = 2) -> M:
        """Ollama constrains generation to a JSON schema, so ask for the schema directly.

        Constrained decoding gets the shape right; it cannot get the content right,
        so a failed validation is still handed back for a bounded number of retries.
        """
        from .structured import validate_reply

        schema = response_model.model_json_schema()
        messages: List[Dict[str, Any]] = [{"role": "user", "content": prompt}]
        errors: List[str] = []

        for _ in range(max_retries + 1):
            body: Dict[str, Any] = {
                "model": self.model,
                "messages": self.to_api_messages(system, messages),
                "stream": False,
                "format": schema,
                "options": self._options(),
            }
            if self.keep_alive:
                body["keep_alive"] = self.keep_alive

            reply = self._to_reply(await self._post("/api/chat", body))
            value, errors = validate_reply(reply.content, response_model)
            if value is not None:
                return value

            messages.append({"role": "assistant", "content": reply.content})
            messages.append(
                {
                    "role": "user",
                    "content": "That reply failed validation:\n- "
                    + "\n- ".join(errors)
                    + "\nReturn the corrected JSON only.",
                }
            )

        raise ProviderError("Structured output failed validation: " + "; ".join(errors))


def _ollama_error(resp: Any, model: str, host: str) -> str:
    """Turn an Ollama error body into something an operator can act on."""
    try:
        detail = str((resp.json() or {}).get("error") or "").strip()
    except ValueError:
        detail = (resp.text or "").strip()

    if resp.status_code == 404 and "model" in detail.lower():
        return f'Ollama has no model "{model}". Pull it first: ollama pull {model}'
    if resp.status_code in (401, 403):
        return "Ollama rejected the credentials. Check OLLAMA_API_KEY."
    if resp.status_code == 429:
        return "Rate limited by Ollama; retry shortly."
    return f"Ollama error {resp.status_code} from {host}" + (f": {detail}" if detail else ".")


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


def _clean(env: Mapping[str, str], key: str) -> str:
    return (env.get(key) or "").strip()


def _number(env: Mapping[str, str], key: str, default: Optional[float] = None) -> Optional[float]:
    raw = _clean(env, key)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def provider_status(env: Mapping[str, str] = os.environ) -> Dict[str, Any]:
    """What the runtime would use, and why — surfaced by /api/health and the console."""
    mode = (_clean(env, "RECALLER_LLM_PROVIDER") or "auto").lower()
    anthropic_creds = bool(_clean(env, "ANTHROPIC_API_KEY") or _clean(env, "ANTHROPIC_AUTH_TOKEN"))
    # A default host is not evidence of a server, so auto-selection needs someone
    # to have actually named one. RECALLER_LLM_PROVIDER=ollama skips that test.
    ollama_configured = bool(_clean(env, "OLLAMA_HOST") or _clean(env, "OLLAMA_API_KEY"))

    if mode == "auto":
        provider = "anthropic" if anthropic_creds else ("ollama" if ollama_configured else None)
    elif mode in ("anthropic", "ollama"):
        provider = mode
    else:
        provider = None

    default_model = {"anthropic": DEFAULT_ANTHROPIC_MODEL, "ollama": DEFAULT_OLLAMA_MODEL}.get(provider or "")
    status: Dict[str, Any] = {
        "mode": mode,
        "provider": provider,
        "model": (_clean(env, "RECALLER_LLM_MODEL") or default_model) if provider else None,
        "effort": _clean(env, "RECALLER_LLM_EFFORT") or None,
        # "has what it needs to authenticate" — a local Ollama needs nothing.
        "credentials_detected": anthropic_creds if provider == "anthropic" else (provider == "ollama"),
        "enabled": provider is not None,
    }
    if provider == "ollama":
        status["host"] = _clean(env, "OLLAMA_HOST") or DEFAULT_OLLAMA_HOST
        status["api_key_detected"] = bool(_clean(env, "OLLAMA_API_KEY"))
        status["effort"] = None
    return status


def provider_from_env(env: Mapping[str, str] = os.environ) -> Optional[Union[AnthropicProvider, OllamaProvider]]:
    status = provider_status(env)
    provider = status["provider"]

    if provider == "anthropic":
        return AnthropicProvider(model=status["model"], effort=status["effort"])

    if provider == "ollama":
        num_ctx = _number(env, "RECALLER_OLLAMA_NUM_CTX")
        return OllamaProvider(
            model=status["model"],
            host=status["host"],
            api_key=_clean(env, "OLLAMA_API_KEY") or None,
            temperature=_number(env, "RECALLER_LLM_TEMPERATURE", 0.0) or 0.0,
            num_ctx=int(num_ctx) if num_ctx else None,
            keep_alive=_clean(env, "OLLAMA_KEEP_ALIVE") or None,
        )

    return None
