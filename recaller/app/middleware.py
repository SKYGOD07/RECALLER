"""RECALLER — HTTP observability and error envelope.

Every response carries:
  X-Request-ID      echoed from the request, or generated; quote it when reporting a problem
  Server-Timing     app;dur=<ms> — Chrome DevTools shows it in the request's Timing tab
  X-Response-Time   the same figure, for tools that do not read Server-Timing

Every error has one shape, whatever raised it:
  {"error": {"code": "APPLICATION_NOT_FOUND", "message": "...", "request_id": "...", "details": ...}}

Recent /api requests are kept in a ring buffer served at /api/diagnostics/requests.
"""

from __future__ import annotations

import logging
import time
import traceback
import uuid
from collections import deque
from typing import Any, Deque, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .db import now_iso
from .service import ServiceError

log = logging.getLogger("recaller.http")

_STATUS_CODES = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED",
                 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 422: "VALIDATION_ERROR",
                 429: "RATE_LIMITED", 500: "INTERNAL_ERROR", 503: "SERVICE_UNAVAILABLE"}


class RequestLog:
    def __init__(self, size: int = 500) -> None:
        self._entries: Deque[Dict[str, Any]] = deque(maxlen=size)

    def add(self, entry: Dict[str, Any]) -> None:
        self._entries.appendleft(entry)

    def list(self, limit: int = 100, path: Optional[str] = None) -> List[Dict[str, Any]]:
        items = [e for e in self._entries if not path or e["path"].startswith(path)]
        return items[:limit]

    def clear(self) -> None:
        self._entries.clear()


def _error(status: int, code: str, message: str, request: Request, details: Any = None) -> JSONResponse:
    rid = getattr(request.state, "request_id", None)
    body = {"error": {"code": code, "message": message, "request_id": rid, **({"details": details} if details is not None else {})}}
    return JSONResponse(body, status_code=status, headers={"X-Error-Code": code})


def install(app: FastAPI, request_log: RequestLog) -> None:
    @app.exception_handler(ServiceError)
    async def _service_error(request: Request, exc: ServiceError):
        return _error(exc.status, exc.code, exc.message, request, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        details = [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
        return _error(422, "VALIDATION_ERROR", "The request did not match the expected shape.", request, details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        return _error(exc.status_code, _STATUS_CODES.get(exc.status_code, f"HTTP_{exc.status_code}"), str(exc.detail), request)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = (request.headers.get("x-request-id") or uuid.uuid4().hex[:12])[:64]
        request.state.request_id = rid
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:  # anything unhandled still leaves with the envelope and a request id
            log.error("unhandled error on %s %s [%s]\n%s", request.method, request.url.path, rid, traceback.format_exc())
            response = _error(500, "INTERNAL_ERROR", f"{type(exc).__name__}: {exc}", request)
        ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = rid
        response.headers["Server-Timing"] = f"app;dur={ms:.1f}"
        response.headers["X-Response-Time"] = f"{ms:.1f}ms"
        path = request.url.path
        if path.startswith("/api") and not path.startswith("/api/diagnostics/requests"):
            request_log.add(
                {
                    "request_id": rid,
                    "at": now_iso(),
                    "method": request.method,
                    "path": path,
                    "query": request.url.query or None,
                    "status": response.status_code,
                    "ms": round(ms, 1),
                    "error_code": response.headers.get("X-Error-Code"),
                    "stream": response.headers.get("content-type", "").startswith("text/event-stream"),
                }
            )
        return response
