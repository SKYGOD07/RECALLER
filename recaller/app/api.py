"""RECALLER — HTTP API.

Every route is under /api and documented in OpenAPI (/docs, /redoc,
/openapi.json). Long work (underwriting, resume, agent runs) returns
``202 Accepted`` with a job; progress streams over Server-Sent Events at
``/api/applications/{id}/events``, which DevTools shows under the request's
EventStream tab.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, File, Form, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..ai.hermes import list_skills
from .middleware import RequestLog
from .service import ServiceError, UnderwritingService


class CreateApplicationBody(BaseModel):
    borrower_name: str = Field(min_length=1, max_length=120)
    segment: str
    loan_amount: float = Field(gt=0)
    tenure_months: int = Field(gt=0, le=120)
    declared_monthly_income: float = Field(ge=0)
    branch: str = ""
    officer: str = ""
    dealer: str = ""
    occupation: str = ""


class SampleBody(BaseModel):
    type: str


class UnderwriteBody(BaseModel):
    paced: bool = True


class Resolution(BaseModel):
    path: str
    action: Literal["CONFIRM", "EDIT", "REJECT"]
    value: Any = None
    note: Optional[str] = None
    by: Optional[str] = None
    at: Optional[str] = None


class ResumeBody(BaseModel):
    resolutions: List[Resolution]
    paced: bool = True


class ReplayBody(BaseModel):
    policy: Optional[Dict[str, Any]] = None
    label: str = "Replay with original policy"


class WhatIfBody(BaseModel):
    target: Literal["APPROVE", "REFER"] = "APPROVE"


class SimulateBody(BaseModel):
    scenario: Dict[str, Any]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20000)


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    history: List[ChatTurn] = Field(default_factory=list, max_length=40)


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str, ensure_ascii=False)}\n\n"


def build_router(service: UnderwritingService, request_log: RequestLog, started_at: float) -> APIRouter:
    r = APIRouter(prefix="/api")

    # ---------------------------------------------------------------- system

    @r.get("/health", tags=["system"], summary="Liveness, dependencies and model status")
    async def health():
        import time

        return {"status": "ok", "uptime_s": round(time.time() - started_at, 1), **service.status()}

    @r.get("/bootstrap", tags=["system"], summary="Everything the console needs to start: policy, vocabulary, queue")
    async def bootstrap():
        return service.bootstrap()

    @r.get("/policy", tags=["system"])
    async def policy():
        return service.policy

    @r.get("/stage-plan", tags=["system"])
    async def stage_plan():
        return service.bootstrap()["stage_plan"]

    @r.get("/quote", tags=["system"], summary="Indicative EMI from the deterministic engine")
    async def quote(segment: str, amount: float = Query(gt=0), tenure: int = Query(gt=0, le=120)):
        return service.quote(segment, amount, tenure)

    @r.get("/samples", tags=["documents"], summary="Synthetic sample documents available to attach")
    async def samples():
        return service.samples()

    @r.get("/skills", tags=["agents"], summary="Agent skills shipped with this build")
    async def skills():
        return list_skills()

    @r.post("/reset", tags=["system"], summary="Wipe the database and uploads, then reseed the demo book")
    async def reset():
        service.reset()
        return {"ok": True, "applications": service.list_applications()}

    # ---------------------------------------------------------------- diagnostics

    @r.get("/diagnostics/requests", tags=["diagnostics"], summary="Recent API requests (ring buffer)")
    async def diag_requests(limit: int = Query(100, ge=1, le=500), path: Optional[str] = None):
        return request_log.list(limit, path)

    @r.delete("/diagnostics/requests", tags=["diagnostics"], status_code=204)
    async def diag_clear():
        request_log.clear()
        return Response(status_code=204)

    @r.get("/diagnostics/jobs", tags=["diagnostics"], summary="Underwriting jobs, running and recent")
    async def diag_jobs():
        return service.jobs.list()

    @r.get("/diagnostics/config", tags=["diagnostics"], summary="Effective runtime configuration (no secrets)")
    async def diag_config():
        from ..config import effective_config

        return {"settings": service.settings.as_public_dict(), "tunables": effective_config(), **service.status()}

    @r.post("/diagnostics/llm", tags=["diagnostics"], summary="Send the configured model one short prompt and return its reply")
    async def diag_llm():
        return await service.check_llm()

    # ---------------------------------------------------------------- applications

    @r.get("/applications", tags=["applications"])
    async def list_applications():
        return service.list_applications()

    @r.post("/applications", tags=["applications"], status_code=201)
    async def create_application(body: CreateApplicationBody):
        return service.create_application(body.model_dump())

    @r.post("/applications/extract-draft", tags=["applications"], summary="Scan document with PyMuPDF/OCR and extract draft application fields via Hermes")
    async def extract_draft(file: UploadFile = File(...)):
        limit = service.settings.max_upload_mb * 1024 * 1024
        data = await file.read(limit + 1)
        return await service.extract_application_draft(file.filename or "document", data, file.content_type)

    @r.get("/applications/{app_id}", tags=["applications"], summary="Header, documents, record, progress, replays, job, agent runs")
    async def get_application(app_id: str):
        return service.detail(app_id)

    @r.delete("/applications/{app_id}", tags=["applications"], status_code=204)
    async def delete_application(app_id: str):
        service.delete_application(app_id)
        return Response(status_code=204)

    # ---------------------------------------------------------------- documents

    @r.post("/applications/{app_id}/documents", tags=["documents"], status_code=201, summary="Upload a document (multipart)")
    async def upload(app_id: str, type: str = Form(...), file: UploadFile = File(...)):
        limit = service.settings.max_upload_mb * 1024 * 1024
        data = await file.read(limit + 1)
        return service.add_upload(app_id, type, file.filename or "document", data, file.content_type)

    @r.post("/applications/{app_id}/documents/sample", tags=["documents"], status_code=201, summary="Attach a synthetic sample document")
    async def attach_sample(app_id: str, body: SampleBody):
        return service.add_sample_document(app_id, body.type)

    @r.delete("/applications/{app_id}/documents/{doc_id}", tags=["documents"], status_code=204)
    async def remove_document(app_id: str, doc_id: str):
        service.remove_document(app_id, doc_id)
        return Response(status_code=204)

    @r.get("/documents/{doc_id}", tags=["documents"], summary="Document metadata and extracted text")
    async def document(doc_id: str):
        return service.document_detail(doc_id)

    @r.get("/documents/{doc_id}/file", tags=["documents"], summary="The original uploaded file")
    async def document_file(doc_id: str):
        d = service.document_file(doc_id)
        return FileResponse(service.settings.data_dir / d["storage_path"], media_type=d.get("media_type"), filename=d["filename"])

    # ---------------------------------------------------------------- runs

    async def _run(app_id: str, job: Dict[str, Any], run_async: bool, response: Response):
        """``?async=true``: 202 + job, follow it over SSE. Default: wait and return the finished record."""
        if run_async:
            response.status_code = 202
            return {"job": job}
        await service.jobs.wait(app_id)
        finished = service.jobs.latest(app_id)
        if finished and finished.status == "FAILED":
            raise ServiceError(500, "RUN_FAILED", finished.error or "The run failed.", {"job_id": finished.id})
        return service.detail(app_id)["record"]

    @r.post(
        "/applications/{app_id}/underwrite",
        tags=["runs"],
        summary="Underwrite. Default waits and returns the record; ?async=true returns 202 + job (stream it from /events)",
    )
    async def underwrite(app_id: str, response: Response, body: Optional[UnderwriteBody] = None, run_async: bool = Query(False, alias="async")):
        job = service.start_underwriting(app_id, paced=(body.paced if body else True))
        return await _run(app_id, job, run_async, response)

    @r.post(
        "/applications/{app_id}/resume",
        tags=["runs"],
        summary="Resume after officer review. Default waits and returns the record; ?async=true returns 202 + job",
    )
    async def resume(app_id: str, body: ResumeBody, response: Response, run_async: bool = Query(False, alias="async")):
        job = service.start_resume(app_id, [x.model_dump() for x in body.resolutions], paced=body.paced)
        return await _run(app_id, job, run_async, response)

    @r.get("/applications/{app_id}/job", tags=["runs"], summary="Latest job for this application, with its events")
    async def job(app_id: str):
        service.require_app(app_id)
        j = service.jobs.latest(app_id)
        return {**j.public(), "log": j.events} if j else None

    @r.get("/applications/{app_id}/events", tags=["runs"], summary="Server-Sent Events: snapshot, stage, end, agent")
    async def events(app_id: str, request: Request, once: bool = Query(False, description="Close the stream after the next job ends")):
        header = service.require_app(app_id)
        queue = service.jobs.subscribe(app_id)
        running = service.jobs.running(app_id)

        async def stream():
            try:
                yield f"retry: {service.settings.sse_retry_ms}\n\n"
                yield _sse("snapshot", {"status": header.get("status"), "progress": service.progress_for(app_id), "job": running.public() if running else None})
                if once and running is None:
                    yield _sse("end", {"status": "IDLE", "result_status": header.get("status")})
                    return
                while True:
                    if await request.is_disconnected():
                        return
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=service.settings.sse_keepalive_s)
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
                        continue
                    yield _sse(event.get("type", "message"), event)
                    if once and event.get("type") == "end":
                        return
            finally:
                service.jobs.unsubscribe(app_id, queue)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @r.post("/applications/{app_id}/replay", tags=["runs"], summary="Re-execute from frozen evidence (optionally with an amended policy)")
    async def replay(app_id: str, body: Optional[ReplayBody] = None):
        body = body or ReplayBody()
        return await service.replay(app_id, body.policy, body.label)

    @r.post("/applications/{app_id}/whatif", tags=["runs"], summary="Exact minimum change to reach a target verdict")
    async def what_if(app_id: str, body: Optional[WhatIfBody] = None):
        return service.what_if(app_id, (body or WhatIfBody()).target)

    @r.post("/applications/{app_id}/simulate", tags=["runs"], summary="Evaluate one scenario (amount, tenure, co-applicant income)")
    async def simulate(app_id: str, body: SimulateBody):
        return service.simulate(app_id, body.scenario)

    @r.get("/applications/{app_id}/audit/verify", tags=["runs"], summary="Recompute the hash chain of the audit ledger")
    async def verify(app_id: str):
        return service.verify_audit(app_id)

    # ---------------------------------------------------------------- agents

    # Registered before /agent/{kind}, which would otherwise claim "ask".
    @r.post("/applications/{app_id}/agent/ask", tags=["agents"], summary="Ask the model about this file (read-only tools, credit-underwriter skill)")
    async def agent_ask(app_id: str, body: AskBody):
        return await service.ask(app_id, body.question, [t.model_dump() for t in body.history])

    @r.post("/applications/{app_id}/agent/{kind}", tags=["agents"], status_code=202, summary="Start a review or explain run (needs a model)")
    async def agent_run(app_id: str, kind: Literal["review", "explain"]):
        return service.start_agent_run(app_id, kind)

    @r.get("/applications/{app_id}/agent-runs", tags=["agents"])
    async def agent_runs(app_id: str):
        service.require_app(app_id)
        return service.db.list_agent_runs(app_id)

    @r.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def unknown(rest: str):
        raise ServiceError(404, "ROUTE_NOT_FOUND", f"No API route /api/{rest}.")

    return r
