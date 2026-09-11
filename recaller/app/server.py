"""RECALLER — application factory.

  uvicorn recaller.app.server:create_app --factory      (what `recaller serve` runs)

The factory builds one app around one database; tests build their own with a
temporary data directory and a scripted model provider.
"""

from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..ai.hermes import provider_from_env
from ..config import Settings, get_settings
from ..core.constants import ENGINE_VERSION
from .api import build_router
from .db import Database
from .jobs import JobManager
from .middleware import RequestLog, install
from .service import UnderwritingService

_UNSET: Any = object()

TAGS = [
    {"name": "system", "description": "Health, bootstrap, policy, indicative quotes."},
    {"name": "applications", "description": "Loan applications and their full state."},
    {"name": "documents", "description": "Uploads (PDF/text/image) and synthetic samples."},
    {"name": "runs", "description": "Underwriting, officer resume, replay, what-if, audit verification."},
    {"name": "agents", "description": "Hermes-based review and explanation. Advisory only; needs a model."},
    {"name": "diagnostics", "description": "Request log, jobs and effective configuration for debugging."},
]


def create_app(settings: Optional[Settings] = None, provider: Any = _UNSET) -> FastAPI:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    settings = settings or get_settings()
    policy = json.loads(settings.policy_path.read_text(encoding="utf-8"))
    db = Database(settings.db_path)
    jobs = JobManager(history=settings.job_history)
    request_log = RequestLog(size=settings.request_log_size)
    service = UnderwritingService(settings, db, jobs, policy, provider=provider_from_env() if provider is _UNSET else provider)
    started_at = time.time()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        service.ensure_seeded()
        service.recover_interrupted()
        yield
        await jobs.cancel_all()
        db.close()

    app = FastAPI(
        title="RECALLER API",
        version=ENGINE_VERSION,
        description="AI agentic credit underwriter for thin-file green borrowers. Models read; code computes; policy decides.",
        openapi_tags=TAGS,
        lifespan=lifespan,
    )
    app.state.service = service
    app.state.request_log = request_log

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "Server-Timing", "X-Response-Time", "X-Error-Code"],
    )
    install(app, request_log)
    app.include_router(build_router(service, request_log, started_at))

    dist = settings.app_dist
    if (dist / "index.html").is_file():
        if (dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def console(full_path: str):
            candidate = (dist / full_path).resolve()
            if full_path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app


def __getattr__(name: str) -> Any:
    if name == "app":
        return create_app()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
