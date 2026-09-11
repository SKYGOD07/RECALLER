"""RECALLER — runtime settings.

Every tunable the backend reads is listed once, in ``DEFAULTS`` below, under the
environment variable that overrides it. A value comes from the real environment
first, then the git-ignored ``.env`` at the repository root, then ``DEFAULTS``.
``.env.example`` documents the same keys; ``GET /api/diagnostics/config`` shows
the effective value of each and whether it was set or defaulted.

Secrets (``ANTHROPIC_API_KEY``, ``OLLAMA_API_KEY``) have no default, are read
only by ``recaller/ai/hermes/providers.py`` and are never reported back.

Data is not configuration: the synthetic book (``recaller/synthetic``) and the
credit policy (``policy/policy.v1.json``) are loaded exactly as they are.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

FROZEN = bool(getattr(sys, "frozen", False))
ROOT = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) if FROZEN else Path(__file__).resolve().parent.parent

DEFAULTS: Dict[str, str] = {
    # -- server
    "RECALLER_HOST": "127.0.0.1",
    "RECALLER_PORT": "4180",
    "RECALLER_DATA_DIR": "",  # empty: ./var, or %LOCALAPPDATA%/RECALLER for the packaged build
    "RECALLER_MAX_UPLOAD_MB": "20",
    "RECALLER_CORS_ORIGINS": "http://127.0.0.1:5180,http://localhost:5180,http://127.0.0.1:5173,http://localhost:5173",  # the console dev servers
    "RECALLER_REQUEST_LOG_SIZE": "500",
    "RECALLER_JOB_HISTORY": "50",
    "RECALLER_SSE_KEEPALIVE_SECONDS": "15",
    "RECALLER_SSE_RETRY_MS": "3000",
    # -- applications
    "RECALLER_APP_ID_FORMAT": "RCL-{year}-{seq:04d}",
    "RECALLER_APP_SEQUENCE_START": "500",
    # -- processing view: seconds each stage is held open, modelled on real
    #    document-understanding latency. The ledger records real engine time regardless.
    "RECALLER_STAGE_PACING": "1",
    "RECALLER_STAGE_PACING_SCALE": "1",
    "RECALLER_STAGE_PACING_SECONDS": (
        "INGEST=0.38,KYC=0.90,BANK=1.50,PLATFORM=0.85,INVOICE=0.78,VALIDATE=0.42,"
        "RECONCILE=0.62,GATE=0.34,CREDIT=0.52,POLICY=0.46,DECISION=0.38,MEMO=0.70"
    ),
    # -- pattern extractor: confidence given to a value read off a labelled line
    "RECALLER_PATTERN_CONFIDENCE": "0.93",
    "RECALLER_PATTERN_LONG_TEXT_CONFIDENCE": "0.90",
    # -- agents
    "RECALLER_AGENT_MAX_ITERATIONS": "12",
    "RECALLER_AGENT_MAX_CHILDREN": "4",
    # -- model
    "RECALLER_LLM_PROVIDER": "auto",
    "RECALLER_LLM_MODEL": "",  # overrides the provider's default model below
    "RECALLER_ANTHROPIC_MODEL": "claude-opus-5",
    "RECALLER_OLLAMA_MODEL": "llama3.1",
    "OLLAMA_HOST": "http://127.0.0.1:11434",
    "RECALLER_OLLAMA_CLOUD_HOST": "https://ollama.com",  # used when OLLAMA_API_KEY is set without OLLAMA_HOST
    "RECALLER_LLM_TIMEOUT": "300",
    "RECALLER_LLM_MAX_TOKENS": "16000",
    "RECALLER_LLM_RETRIES": "4",  # Ollama: retries on rate limits (429), 5xx and connection errors, with backoff
    "RECALLER_LLM_CONCURRENCY": "2",  # Ollama: model calls in flight at once; the rest queue
    "RECALLER_LLM_TEMPERATURE": "0",
    "RECALLER_LLM_EFFORT": "",
    "RECALLER_OLLAMA_THINK": "",
    "RECALLER_OLLAMA_NUM_CTX": "",
    "OLLAMA_KEEP_ALIVE": "",
}

_TRUE = ("1", "true", "yes", "on")
_FALSE = ("0", "false", "no", "off")


class ConfigError(ValueError):
    """A setting is present but unusable. The message names the variable."""


# ---------------------------------------------------------------------------- .env


def _read_dotenv(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value[:1] in ('"', "'") and value[-1:] == value[:1]:
            value = value[1:-1]
        elif " #" in value:  # trailing comment on an unquoted value
            value = value.split(" #", 1)[0].rstrip()
        out[key.strip()] = value
    return out


_dotenv_applied = False


def apply_dotenv() -> None:
    """Load ``.env`` into the process environment without overriding real variables."""
    global _dotenv_applied
    for k, v in _read_dotenv(ROOT / ".env").items():
        os.environ.setdefault(k, v)
    _dotenv_applied = True


# ---------------------------------------------------------------------------- typed reads


def raw(key: str, env: Optional[Mapping[str, str]] = None) -> str:
    """The configured string for ``key``: ``env`` (default: the process environment
    with ``.env`` applied), else its entry in ``DEFAULTS``, else empty."""
    if env is None:
        if not _dotenv_applied:
            apply_dotenv()
        env = os.environ
    value = (env.get(key) or "").strip()
    return value if value else DEFAULTS.get(key, "")


def is_set(key: str, env: Optional[Mapping[str, str]] = None) -> bool:
    if env is None:
        if not _dotenv_applied:
            apply_dotenv()
        env = os.environ
    return bool((env.get(key) or "").strip())


def get_str(key: str, env: Optional[Mapping[str, str]] = None) -> str:
    return raw(key, env)


def get_int(key: str, env: Optional[Mapping[str, str]] = None, *, minimum: Optional[int] = None) -> int:
    value = raw(key, env)
    try:
        n = int(value)
    except ValueError:
        raise ConfigError(f"{key}={value!r} is not a whole number.") from None
    if minimum is not None and n < minimum:
        raise ConfigError(f"{key}={n} must be at least {minimum}.")
    return n


def get_optional_int(key: str, env: Optional[Mapping[str, str]] = None, *, minimum: Optional[int] = None) -> Optional[int]:
    return get_int(key, env, minimum=minimum) if raw(key, env) else None


def get_float(
    key: str, env: Optional[Mapping[str, str]] = None, *, minimum: Optional[float] = None, maximum: Optional[float] = None
) -> float:
    value = raw(key, env)
    try:
        x = float(value)
    except ValueError:
        raise ConfigError(f"{key}={value!r} is not a number.") from None
    if (minimum is not None and x < minimum) or (maximum is not None and x > maximum):
        raise ConfigError(f"{key}={x} must be between {minimum} and {maximum}.")
    return x


def get_bool(key: str, env: Optional[Mapping[str, str]] = None) -> bool:
    value = raw(key, env).lower()
    if value in _TRUE:
        return True
    if value in _FALSE or value == "":
        return False
    raise ConfigError(f"{key}={value!r} must be one of {', '.join(_TRUE + _FALSE)}.")


def get_list(key: str, env: Optional[Mapping[str, str]] = None) -> List[str]:
    return [item.strip() for item in raw(key, env).split(",") if item.strip()]


def parse_stage_seconds(text: str, key: str = "RECALLER_STAGE_PACING_SECONDS") -> Dict[str, float]:
    """``"KYC=0.9,BANK=1.5"`` → ``{"KYC": 0.9, "BANK": 1.5}``."""
    out: Dict[str, float] = {}
    for part in text.split(","):
        if not part.strip():
            continue
        name, sep, secs = part.partition("=")
        try:
            if not sep:
                raise ValueError
            out[name.strip().upper()] = max(0.0, float(secs))
        except ValueError:
            raise ConfigError(f"{key}: {part.strip()!r} is not STAGE=seconds.") from None
    return out


def stage_seconds(env: Optional[Mapping[str, str]] = None) -> Dict[str, float]:
    """Default pacing, with any stages named in the environment replaced."""
    merged = parse_stage_seconds(DEFAULTS["RECALLER_STAGE_PACING_SECONDS"])
    if is_set("RECALLER_STAGE_PACING_SECONDS", env):
        merged.update(parse_stage_seconds(raw("RECALLER_STAGE_PACING_SECONDS", env)))
    return merged


def effective_config(env: Optional[Mapping[str, str]] = None) -> Dict[str, Dict[str, Any]]:
    """Every tunable with its effective value and where it came from. Holds no secrets."""
    return {k: {"value": raw(k, env), "source": "set" if is_set(k, env) else "default"} for k in DEFAULTS}


# ---------------------------------------------------------------------------- settings


def _default_data_dir() -> Path:
    if FROZEN:
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(base) / "RECALLER"
    return ROOT / "var"


@dataclass(frozen=True)
class Settings:
    root: Path
    data_dir: Path
    db_path: Path
    uploads_dir: Path
    policy_path: Path
    app_dist: Path
    max_upload_mb: int
    stage_pacing: bool
    cors_origins: List[str]
    host: str = field(default_factory=lambda: get_str("RECALLER_HOST"))
    port: int = field(default_factory=lambda: get_int("RECALLER_PORT", minimum=1))
    stage_pacing_scale: float = field(default_factory=lambda: get_float("RECALLER_STAGE_PACING_SCALE", minimum=0.0))
    stage_seconds: Dict[str, float] = field(default_factory=stage_seconds)
    app_id_format: str = field(default_factory=lambda: get_str("RECALLER_APP_ID_FORMAT"))
    app_sequence_start: int = field(default_factory=lambda: get_int("RECALLER_APP_SEQUENCE_START", minimum=0))
    sse_keepalive_s: float = field(default_factory=lambda: get_float("RECALLER_SSE_KEEPALIVE_SECONDS", minimum=1.0))
    sse_retry_ms: int = field(default_factory=lambda: get_int("RECALLER_SSE_RETRY_MS", minimum=100))
    request_log_size: int = field(default_factory=lambda: get_int("RECALLER_REQUEST_LOG_SIZE", minimum=1))
    job_history: int = field(default_factory=lambda: get_int("RECALLER_JOB_HISTORY", minimum=1))

    def __post_init__(self) -> None:
        try:
            self.format_app_id(self.app_sequence_start + 1)
        except (KeyError, IndexError, ValueError) as exc:
            raise ConfigError(
                f"RECALLER_APP_ID_FORMAT={self.app_id_format!r} is unusable ({exc}); it may use {{year}} and must use {{seq}}."
            ) from None
        if "{seq" not in self.app_id_format:
            raise ConfigError(f"RECALLER_APP_ID_FORMAT={self.app_id_format!r} must contain {{seq}}, or every id would collide.")

    def format_app_id(self, seq: int) -> str:
        return self.app_id_format.format(year=date.today().year, seq=seq)

    def pacing_for(self, stage_id: Optional[str]) -> float:
        return self.stage_seconds.get(stage_id or "", 0.0) * self.stage_pacing_scale

    def as_public_dict(self) -> Dict[str, object]:
        return {
            "data_dir": str(self.data_dir),
            "db_path": str(self.db_path),
            "uploads_dir": str(self.uploads_dir),
            "policy_path": str(self.policy_path),
            "console_built": (self.app_dist / "index.html").is_file(),
            "host": self.host,
            "port": self.port,
            "max_upload_mb": self.max_upload_mb,
            "cors_origins": ", ".join(self.cors_origins),
            "stage_pacing": self.stage_pacing,
            "stage_pacing_scale": self.stage_pacing_scale,
            "app_id_format": self.app_id_format,
            "app_sequence_start": self.app_sequence_start,
            "frozen": FROZEN,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    apply_dotenv()
    data_dir = Path(get_str("RECALLER_DATA_DIR") or _default_data_dir()).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    uploads = data_dir / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    return Settings(
        root=ROOT,
        data_dir=data_dir,
        db_path=data_dir / "recaller.sqlite3",
        uploads_dir=uploads,
        policy_path=ROOT / "policy" / "policy.v1.json",
        app_dist=ROOT / "app" / "dist",
        max_upload_mb=get_int("RECALLER_MAX_UPLOAD_MB", minimum=1),
        stage_pacing=get_bool("RECALLER_STAGE_PACING"),
        cors_origins=get_list("RECALLER_CORS_ORIGINS"),
    )
