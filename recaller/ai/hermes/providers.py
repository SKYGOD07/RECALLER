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

Selection (``provider_from_env``). Values come from the environment or ``.env``;
defaults live in ``recaller/config.py`` (``DEFAULTS``), documented in ``.env.example``:
  RECALLER_LLM_PROVIDER=auto        Anthropic if ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set,
                                    else Ollama if OLLAMA_HOST / OLLAMA_API_KEY is set, else none
  RECALLER_LLM_PROVIDER=anthropic   always Anthropic (also works with an `ant auth login` profile)
  RECALLER_LLM_PROVIDER=ollama      always Ollama
  RECALLER_LLM_PROVIDER=none        no model; RECALLER runs fully deterministic
  RECALLER_LLM_MODEL                overrides RECALLER_ANTHROPIC_MODEL / RECALLER_OLLAMA_MODEL
  RECALLER_LLM_EFFORT               Anthropic only: low | medium | high | xhigh | max
  RECALLER_LLM_TEMPERATURE          Ollama only, default 0 — underwriting wants repeatable reads
  RECALLER_LLM_TIMEOUT, RECALLER_LLM_MAX_TOKENS

  OLLAMA_HOST                       a local server by default. Unset with OLLAMA_API_KEY set means
                                    Ollama Cloud (RECALLER_OLLAMA_CLOUD_HOST, https://ollama.com)
  OLLAMA_API_KEY                    Ollama Cloud key. A local server needs none.
  RECALLER_OLLAMA_THINK             true | false | low | medium | high; unset leaves it to the model

Ollama Cloud's own API names a model without the ``:cloud`` / ``-cloud`` suffix
the local daemon uses (``nemotron-3-ultra``, not ``nemotron-3-ultra:cloud``); the
suffix is dropped when talking to Cloud directly, and /api/health says so.

Whichever provider is configured, it only ever reads documents and explains a
finished decision. No provider is reachable from the credit engine, the policy
engine or the what-if solver, and the tool registry refuses any tool that would
decide or compute a credit outcome.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Type, TypeVar, Union
from urllib.parse import urlparse

from pydantic import BaseModel

from ...config import DEFAULTS, ConfigError, get_float, get_int, get_optional_int, is_set, raw
from .structured import generate_structured

# Shipped defaults, from the one table in recaller/config.py; the environment overrides each.
DEFAULT_ANTHROPIC_MODEL = DEFAULTS["RECALLER_ANTHROPIC_MODEL"]
DEFAULT_OLLAMA_MODEL = DEFAULTS["RECALLER_OLLAMA_MODEL"]
DEFAULT_OLLAMA_HOST = DEFAULTS["OLLAMA_HOST"]
OLLAMA_CLOUD_HOST = DEFAULTS["RECALLER_OLLAMA_CLOUD_HOST"]
DEFAULT_TIMEOUT = float(DEFAULTS["RECALLER_LLM_TIMEOUT"])
DEFAULT_MAX_TOKENS = int(DEFAULTS["RECALLER_LLM_MAX_TOKENS"])
_FALLBACK_BETA = "server-side-fallback-2026-07-01"
_THINK_BLOCK = re.compile(r"<think>[\s\S]*?</think>", re.I)
_THINK_LEVELS = ("low", "medium", "high")

M = TypeVar("M", bound=BaseModel)


@dataclass
class ModelReply:
    content: str = ""
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    stop_reason: Optional[str] = None
    provider_content: Any = None
    usage: Dict[str, int] = field(default_factory=dict)
    request_id: Optional[str] = None
    thinking: str = ""  # a reasoning model's own reasoning, kept apart from the answer


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
        max_tokens: int = DEFAULT_MAX_TOKENS,
        effort: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
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
        think: Union[bool, str, None] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.model = model
        self.host = str(host).rstrip("/")
        self.api_key = api_key or None
        self.temperature = temperature
        self.num_ctx = num_ctx
        self.keep_alive = keep_alive
        self.think = think
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

    def _common(self, body: Dict[str, Any]) -> None:
        if self.keep_alive:
            body["keep_alive"] = self.keep_alive
        if self.think is not None:
            body["think"] = self.think

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
        self._common(body)

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

        # Reasoning models return their thinking in message.thinking; older builds
        # inline it as <think>…</think>. Either way it is not the answer.
        raw_content = str(message.get("content") or "")
        inline = "\n".join(m.strip() for m in re.findall(r"<think>([\s\S]*?)</think>", raw_content, re.I))
        content = _THINK_BLOCK.sub("", raw_content).strip()
        return ModelReply(
            content=content,
            tool_calls=calls,
            thinking=str(message.get("thinking") or inline or "").strip(),
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
            self._common(body)

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

    cloud = is_cloud_host(host)
    if resp.status_code == 404 and "model" in detail.lower():
        if cloud:
            return f'Ollama Cloud has no model "{model}". Cloud model names are listed at https://ollama.com/search?c=cloud.'
        return f'Ollama has no model "{model}". Pull it first: ollama pull {model}'
    if resp.status_code in (401, 403):
        if cloud:
            return "Ollama Cloud rejected OLLAMA_API_KEY. Create a key at https://ollama.com/settings/keys, put it in .env and restart."
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


def is_cloud_host(host: str) -> bool:
    return (urlparse(str(host)).hostname or "").endswith("ollama.com")


def cloud_model_name(model: str) -> str:
    """The local daemon's name for a cloud model → the name Ollama Cloud's own API uses."""
    for suffix in (":cloud", "-cloud"):
        if model.endswith(suffix):
            return model[: -len(suffix)]
    return model


def parse_think(value: str) -> Union[bool, str, None]:
    v = (value or "").strip().lower()
    if not v:
        return None
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    if v in _THINK_LEVELS:
        return v
    raise ConfigError(f"RECALLER_OLLAMA_THINK={value!r} must be true, false, low, medium or high.")


def provider_status(env: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """What the runtime would use, and why — surfaced by /api/health and the console.

    ``env`` defaults to the process environment with ``.env`` applied. Reports
    whether a key is present, never the key.
    """
    mode = raw("RECALLER_LLM_PROVIDER", env).lower()
    anthropic_creds = is_set("ANTHROPIC_API_KEY", env) or is_set("ANTHROPIC_AUTH_TOKEN", env)
    ollama_key = is_set("OLLAMA_API_KEY", env)
    # A default host is not evidence of a server, so auto-selection needs someone
    # to have actually named one. RECALLER_LLM_PROVIDER=ollama skips that test.
    ollama_configured = is_set("OLLAMA_HOST", env) or ollama_key
    warnings: List[str] = []

    if mode == "auto":
        provider = "anthropic" if anthropic_creds else ("ollama" if ollama_configured else None)
    elif mode in ("anthropic", "ollama"):
        provider = mode
    else:
        provider = None
        if mode != "none":
            warnings.append(f"RECALLER_LLM_PROVIDER={mode!r} is not auto, anthropic, ollama or none, so no model is used.")

    model = None
    if provider:
        model = raw("RECALLER_LLM_MODEL", env) or raw(
            "RECALLER_ANTHROPIC_MODEL" if provider == "anthropic" else "RECALLER_OLLAMA_MODEL", env
        )
    status: Dict[str, Any] = {
        "mode": mode,
        "provider": provider,
        "model": model,
        "effort": raw("RECALLER_LLM_EFFORT", env) or None,
        # "has what it needs to authenticate" — a local Ollama needs nothing.
        "credentials_detected": anthropic_creds if provider == "anthropic" else (provider == "ollama"),
        "enabled": provider is not None,
    }
    if provider == "ollama":
        # A local server needs no key, so a key with no host means Ollama Cloud.
        if is_set("OLLAMA_HOST", env) or not ollama_key:
            host = raw("OLLAMA_HOST", env)
        else:
            host = raw("RECALLER_OLLAMA_CLOUD_HOST", env)
        host = host.rstrip("/")
        cloud = is_cloud_host(host)
        if cloud:
            named = cloud_model_name(model or "")
            if named != model:
                warnings.append(f'Using "{named}": "{model}" is the local-daemon name; Ollama Cloud\'s API drops the suffix.')
                model = named
            if not ollama_key:
                warnings.append("OLLAMA_API_KEY is not set; Ollama Cloud will reject every request.")
        status.update(
            model=model,
            host=host,
            cloud=cloud,
            api_key_detected=ollama_key,
            credentials_detected=ollama_key or not cloud,
            think=raw("RECALLER_OLLAMA_THINK", env) or None,
            effort=None,
        )
    status["warnings"] = warnings
    return status


def provider_from_env(env: Optional[Mapping[str, str]] = None) -> Optional[Union[AnthropicProvider, OllamaProvider]]:
    status = provider_status(env)
    provider = status["provider"]

    if provider == "anthropic":
        return AnthropicProvider(
            model=status["model"],
            effort=status["effort"],
            max_tokens=get_int("RECALLER_LLM_MAX_TOKENS", env, minimum=1),
            timeout=get_float("RECALLER_LLM_TIMEOUT", env, minimum=1.0),
        )

    if provider == "ollama":
        return OllamaProvider(
            model=status["model"],
            host=status["host"],
            api_key=raw("OLLAMA_API_KEY", env) or None,
            temperature=get_float("RECALLER_LLM_TEMPERATURE", env, minimum=0.0, maximum=2.0),
            num_ctx=get_optional_int("RECALLER_OLLAMA_NUM_CTX", env, minimum=1),
            keep_alive=raw("OLLAMA_KEEP_ALIVE", env) or None,
            think=parse_think(raw("RECALLER_OLLAMA_THINK", env)),
            timeout=get_float("RECALLER_LLM_TIMEOUT", env, minimum=1.0),
        )

    return None


async def check_provider(provider: Any) -> Dict[str, Any]:
    """One short round trip, so an operator sees a real reply before trusting the agents with a file."""
    started = time.perf_counter()
    reply = await provider.complete(
        system="You are the model behind RECALLER's document agents. This is a connectivity check.",
        messages=[{"role": "user", "content": "In one short sentence, say that you are ready and name the model you are."}],
        tools=[],
    )
    text = (reply.content or "").strip()
    return {
        "ok": bool(text),
        "provider": getattr(provider, "name", "custom"),
        "model": getattr(provider, "model", None),
        "host": getattr(provider, "host", None),
        "reply": text[:1000],
        "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        "usage": reply.usage,
        "stop_reason": reply.stop_reason,
        "request_id": reply.request_id,
    }
