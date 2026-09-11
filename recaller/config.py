"""RECALLER — runtime settings.

Everything is resolved relative to the install, with environment overrides and
an optional ``.env`` file at the repository root (git-ignored). Nothing here is
machine-specific.

  RECALLER_DATA_DIR        where the database and uploaded files live (default ./var,
                           or %LOCALAPPDATA%/RECALLER for the packaged build)
  RECALLER_MAX_UPLOAD_MB   per-file upload cap (default 20)
  RECALLER_STAGE_PACING    1 to pace the processing view like real extraction (default 1)
  RECALLER_CORS_ORIGINS    comma-separated extra origins for a separately hosted console
  RECALLER_LLM_*           see recaller/ai/hermes/providers.py
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

FROZEN = bool(getattr(sys, "frozen", False))
ROOT = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) if FROZEN else Path(__file__).resolve().parent.parent


def _read_dotenv(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def apply_dotenv() -> None:
    """Load ``.env`` into the process environment without overriding real variables."""
    for k, v in _read_dotenv(ROOT / ".env").items():
        os.environ.setdefault(k, v)


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

    def as_public_dict(self) -> Dict[str, object]:
        return {
            "data_dir": str(self.data_dir),
            "db_path": str(self.db_path),
            "uploads_dir": str(self.uploads_dir),
            "policy_path": str(self.policy_path),
            "console_built": (self.app_dist / "index.html").is_file(),
            "max_upload_mb": self.max_upload_mb,
            "stage_pacing": self.stage_pacing,
            "frozen": FROZEN,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    apply_dotenv()
    data_dir = Path(os.environ.get("RECALLER_DATA_DIR") or _default_data_dir()).resolve()
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
        max_upload_mb=int(os.environ.get("RECALLER_MAX_UPLOAD_MB", "20")),
        stage_pacing=os.environ.get("RECALLER_STAGE_PACING", "1") not in ("0", "false", "no"),
        cors_origins=[o.strip() for o in os.environ.get("RECALLER_CORS_ORIGINS", "").split(",") if o.strip()],
    )
