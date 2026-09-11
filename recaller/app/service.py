"""RECALLER — underwriting service.

The only module the HTTP layer talks to. It owns persistence (``Database``),
background runs (``JobManager``) and the agent layer, and calls the
deterministic pipeline unchanged. Every error it raises is a ``ServiceError``
with a stable code, so the API returns predictable, inspectable failures.
"""

from __future__ import annotations

import asyncio
import re
import shutil
import uuid
from typing import Any, Dict, List, Optional

import pymupdf

from ..ai.hermes import AgentExtractionAdapter, explain_decision, provider_status, review_file
from ..core.audit import verify_ledger
from ..core.constants import APP_STATUS, DOC_LABELS, DOC_TYPES, OPTIONAL_DOCS, REQUIRED_DOCS, WORKFLOW_VERSION
from ..core.hash import hash_value
from ..credit_engine.engine import calculate_emi
from ..documents.pdf import ocr_available, read_document
from ..documents.router import RoutedExtractionAdapter
from ..orchestrator.pipeline import (
    STAGE_PLAN,
    replay as replay_run,
    resume_underwriting,
    run_simulation,
    run_underwriting,
    run_what_if,
)
from ..synthetic.data import SYNTHETIC_APPLICATIONS
from .db import Database, now_iso
from .jobs import JobConflict, JobManager

# Seconds each stage is held open when a run is paced, modelled on real
# document-understanding latency. The ledger records real engine time regardless.
STAGE_PACING = {
    "INGEST": 0.38, "KYC": 0.90, "BANK": 1.50, "PLATFORM": 0.85, "INVOICE": 0.78, "VALIDATE": 0.42,
    "RECONCILE": 0.62, "GATE": 0.34, "CREDIT": 0.52, "POLICY": 0.46, "DECISION": 0.38, "MEMO": 0.70,
}
_RUNTIME_KEYS = ("scenario", "status", "decision", "updated_at", "custom", "document_count", "last_error", "last_job")
_ALL_DOC_TYPES = {v for k, v in vars(DOC_TYPES).items() if not k.startswith("_")}


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details


def _blank_progress() -> Dict[str, str]:
    return {s["id"]: "PENDING" for s in STAGE_PLAN}


class UnderwritingService:
    def __init__(self, settings, db: Database, jobs: JobManager, policy: Dict[str, Any], provider: Any = None) -> None:
        self.settings = settings
        self.db = db
        self.jobs = jobs
        self.policy = policy
        self.policy_hash = hash_value(policy)[:12]
        self.provider = provider
        self._progress: Dict[str, Dict[str, str]] = {}
        self._agent_tasks: Dict[str, asyncio.Task] = {}

    # ------------------------------------------------------------------ seeding

    def ensure_seeded(self) -> None:
        if self.db.get_meta("seeded") == "1":
            return
        with self.db.transaction():
            for app in SYNTHETIC_APPLICATIONS:
                header = {k: v for k, v in app.items() if k != "documents"}
                header.update(status=APP_STATUS.DRAFT, decision=None, updated_at=header.get("created_at"),
                              custom=False, document_count=len(app["documents"]))
                self.db.save_application(header)
                for doc in app["documents"]:
                    self.db.add_document(self._synthetic_row(app["id"], doc))
            self.db.set_meta("app_sequence", "500")
            self.db.set_meta("seeded", "1")

    @staticmethod
    def _synthetic_row(app_id: str, doc: Dict[str, Any], doc_id: Optional[str] = None) -> Dict[str, Any]:
        return {
            "id": doc_id or doc["id"],
            "app_id": app_id,
            "type": doc["type"],
            "filename": doc["filename"],
            "source": "synthetic",
            "media_type": "application/pdf",
            "size_bytes": int(doc.get("size_kb") or 0) * 1024,
            "page_count": doc.get("pages"),
            "uploaded_at": doc.get("uploaded_at") or now_iso(),
            "meta": {k: doc.get(k) for k in ("payload", "degrade", "pageMap", "size_kb")},
        }

    def reset(self) -> None:
        if any(self.jobs.running(a["id"]) for a in self.db.list_applications()):
            raise ServiceError(409, "JOB_RUNNING", "A run is in progress; wait for it to finish before resetting.")
        self.db.wipe()
        self.db.set_meta("seeded", "0")
        for child in self.settings.uploads_dir.iterdir():
            shutil.rmtree(child, ignore_errors=True) if child.is_dir() else child.unlink(missing_ok=True)
        self._progress.clear()
        self.ensure_seeded()

    # ------------------------------------------------------------------ reads

    def require_app(self, app_id: str) -> Dict[str, Any]:
        header = self.db.get_application(app_id)
        if header is None:
            raise ServiceError(404, "APPLICATION_NOT_FOUND", f"Application {app_id} not found.")
        return header

    def require_record(self, app_id: str, *, decided: bool = False) -> Dict[str, Any]:
        self.require_app(app_id)
        record = self.db.get_record(app_id)
        if record is None:
            raise ServiceError(409, "NOT_UNDERWRITTEN", f"{app_id} has not been underwritten yet.")
        if decided and not record.get("decision"):
            raise ServiceError(409, "NOT_DECIDED", f"{app_id} is waiting for officer review and has no decision yet.")
        return record

    def list_applications(self) -> List[Dict[str, Any]]:
        return self.db.list_applications()

    def detail(self, app_id: str) -> Dict[str, Any]:
        header = self.require_app(app_id)
        record = self.db.get_record(app_id)
        if record is not None:
            record = {**record, "audit_verification": verify_ledger(record.get("audit") or {"events": []})}
        job = self.jobs.latest(app_id)
        return {
            "application": header,
            "documents": [self.public_document(d) for d in self.db.list_documents(app_id)],
            "record": record,
            "progress": self.progress_for(app_id, record),
            "replays": self.db.list_replays(app_id),
            "job": job.public() if job else None,
            "agent_runs": self.db.list_agent_runs(app_id),
        }

    def progress_for(self, app_id: str, record: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
        if self.jobs.running(app_id) and app_id in self._progress:
            return dict(self._progress[app_id])
        record = record if record is not None else self.db.get_record(app_id)
        prog = _blank_progress()
        if record:
            checkpoint = record.get("checkpoint") or {}
            for s in checkpoint.get("completed_stages") or [s["id"] for s in STAGE_PLAN]:
                prog[s] = "DONE"
            if record.get("status") == APP_STATUS.WAITING_FOR_OFFICER:
                prog["GATE"] = "HELD"
        return prog

    def public_document(self, d: Dict[str, Any]) -> Dict[str, Any]:
        meta = d.get("meta") or {}
        return {
            "id": d["id"],
            "type": d["type"],
            "label": DOC_LABELS.get(d["type"], d["type"]),
            "filename": d["filename"],
            "source": d["source"],
            "media_type": d.get("media_type"),
            "pages": d.get("page_count"),
            "size_kb": meta.get("size_kb") or round((d.get("size_bytes") or 0) / 1024, 1),
            "sha256": (d.get("sha256") or "")[:16] or None,
            "text_chars": d.get("text_chars", 0),
            "scanned": d.get("scanned", False),
            "warnings": meta.get("warnings", []),
            "uploaded_at": d.get("uploaded_at"),
            "download": f"/api/documents/{d['id']}/file" if d["source"] == "upload" else None,
        }

    def document_detail(self, doc_id: str) -> Dict[str, Any]:
        d = self.db.get_document(doc_id)
        if d is None:
            raise ServiceError(404, "DOCUMENT_NOT_FOUND", f"Document {doc_id} not found.")
        pages = self.db.get_document_text(doc_id) or []
        return {**self.public_document(d), "app_id": d["app_id"], "text_pages": pages}

    def document_file(self, doc_id: str):
        d = self.db.get_document(doc_id)
        if d is None or d["source"] != "upload" or not d.get("storage_path"):
            raise ServiceError(404, "FILE_NOT_FOUND", "No stored file for this document (synthetic documents have none).")
        return d

    def samples(self) -> Dict[str, List[Dict[str, Any]]]:
        out: Dict[str, List[Dict[str, Any]]] = {}
        for app in SYNTHETIC_APPLICATIONS:
            for doc in app["documents"]:
                out.setdefault(doc["type"], []).append(
                    {"donor": app["id"], "segment": app["segment"], "filename": doc["filename"], "pages": doc["pages"], "size_kb": doc.get("size_kb")}
                )
        return out

    def quote(self, segment: str, amount: float, tenure: int) -> Dict[str, Any]:
        seg = self.policy.get("segments", {}).get(segment)
        if seg is None:
            raise ServiceError(422, "UNKNOWN_SEGMENT", f"Unknown asset segment {segment}.")
        if amount <= 0 or tenure <= 0:
            raise ServiceError(422, "INVALID_QUOTE", "Amount and tenure must be positive.")
        return {
            "segment": segment,
            "amount": amount,
            "tenure_months": tenure,
            "rate_annual_pct": seg["rate_annual_pct"],
            "emi": calculate_emi(amount, seg["rate_annual_pct"], tenure),
            "indicative": True,
        }

    def status(self) -> Dict[str, Any]:
        return {
            "db": {"ok": True, "path": str(self.db.path), "counts": self.db.counts()},
            "llm": provider_status() if self.provider is None or getattr(self.provider, "name", "") == "anthropic"
            else {"enabled": True, "provider": getattr(self.provider, "name", "custom"), "model": getattr(self.provider, "model", None)},
            "documents": {"engine": "PyMuPDF", "version": pymupdf.VersionBind, "ocr": ocr_available()},
            "jobs": {"running": sum(1 for j in self.jobs.list() if j["status"] == "RUNNING"), "subscribers": self.jobs.subscriber_count()},
        }

    # ------------------------------------------------------------------ writes

    def create_application(self, form: Dict[str, Any]) -> Dict[str, Any]:
        if form["segment"] not in self.policy.get("segments", {}):
            raise ServiceError(422, "UNKNOWN_SEGMENT", f"Unknown asset segment {form['segment']}.")
        seq = self.db.next_sequence()
        ts = now_iso()
        header = {
            "id": f"RCL-2026-0{seq}",
            "borrower_name": form["borrower_name"].strip(),
            "segment": form["segment"],
            "loan_amount": float(form["loan_amount"]),
            "tenure_months": int(form["tenure_months"]),
            "declared_monthly_income": float(form["declared_monthly_income"]),
            "branch": form.get("branch") or "",
            "officer": form.get("officer") or "",
            "dealer": form.get("dealer") or "",
            "occupation": form.get("occupation") or "",
            "created_at": ts,
            "updated_at": ts,
            "status": APP_STATUS.DRAFT,
            "decision": None,
            "custom": True,
            "document_count": 0,
        }
        self.db.save_application(header)
        return header

    def delete_application(self, app_id: str) -> None:
        header = self.require_app(app_id)
        if not header.get("custom"):
            raise ServiceError(409, "SEEDED_APPLICATION", "Seeded demo files cannot be deleted; use reset instead.")
        self._guard_idle(app_id)
        self.db.delete_application(app_id)
        shutil.rmtree(self.settings.uploads_dir / app_id, ignore_errors=True)

    def _guard_idle(self, app_id: str) -> None:
        if self.jobs.running(app_id):
            raise ServiceError(409, "JOB_RUNNING", f"{app_id} has a run in progress.")

    def _check_doc_type(self, doc_type: str) -> None:
        if doc_type not in _ALL_DOC_TYPES:
            raise ServiceError(422, "UNKNOWN_DOCUMENT_TYPE", f"Unknown document type {doc_type}.", {"allowed": sorted(_ALL_DOC_TYPES)})

    def _replace_same_type(self, app_id: str, doc_type: str) -> None:
        for d in self.db.list_documents(app_id):
            if d["type"] == doc_type:
                self.db.delete_document(d["id"])
                if d.get("storage_path"):
                    try:
                        (self.settings.data_dir / d["storage_path"]).unlink(missing_ok=True)
                    except OSError:
                        pass

    def _after_documents_changed(self, app_id: str) -> Dict[str, Any]:
        header = self.require_app(app_id)
        header["document_count"] = len(self.db.list_documents(app_id))
        header["updated_at"] = now_iso()
        self.db.save_application(header)
        return header

    def add_sample_document(self, app_id: str, doc_type: str) -> Dict[str, Any]:
        header = self.require_app(app_id)
        self._guard_idle(app_id)
        self._check_doc_type(doc_type)
        donors = [a for a in SYNTHETIC_APPLICATIONS if any(d["type"] == doc_type for d in a["documents"])]
        if not donors:
            raise ServiceError(404, "NO_SAMPLE", f"No sample {DOC_LABELS.get(doc_type, doc_type)} is available.")
        donor = next((a for a in donors if a["segment"] == header.get("segment")), donors[0])
        source = next(d for d in donor["documents"] if d["type"] == doc_type)
        self._replace_same_type(app_id, doc_type)
        row = self._synthetic_row(app_id, {**source, "uploaded_at": now_iso()}, doc_id=f"{app_id}-{doc_type}")
        self.db.add_document(row)
        self._after_documents_changed(app_id)
        return self.public_document(self.db.get_document(row["id"]))

    def add_upload(self, app_id: str, doc_type: str, filename: str, data: bytes, content_type: Optional[str]) -> Dict[str, Any]:
        self.require_app(app_id)
        self._guard_idle(app_id)
        self._check_doc_type(doc_type)
        limit = self.settings.max_upload_mb * 1024 * 1024
        if not data:
            raise ServiceError(422, "EMPTY_FILE", "The uploaded file is empty.")
        if len(data) > limit:
            raise ServiceError(413, "FILE_TOO_LARGE", f"Files are limited to {self.settings.max_upload_mb} MB.")
        try:
            result = read_document(data, filename, content_type)
        except ValueError as exc:
            raise ServiceError(415, "UNREADABLE_DOCUMENT", str(exc)) from exc

        self._replace_same_type(app_id, doc_type)
        doc_id = f"{app_id}-{doc_type}-{uuid.uuid4().hex[:6]}"
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)[-80:] or "document"
        rel = f"uploads/{app_id}/{doc_id}__{safe}"
        path = self.settings.data_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        self.db.add_document(
            {
                "id": doc_id,
                "app_id": app_id,
                "type": doc_type,
                "filename": filename,
                "source": "upload",
                "media_type": result.media_type,
                "size_bytes": len(data),
                "page_count": result.page_count,
                "sha256": result.sha256,
                "storage_path": rel,
                "text_chars": result.text_chars,
                "scanned": result.scanned,
                "meta": {"warnings": result.warnings, "ocr_used": result.ocr_used},
            },
            pages=result.pages,
        )
        self._after_documents_changed(app_id)
        return self.public_document(self.db.get_document(doc_id))

    def remove_document(self, app_id: str, doc_id: str) -> None:
        self.require_app(app_id)
        self._guard_idle(app_id)
        d = self.db.get_document(doc_id)
        if d is None or d["app_id"] != app_id:
            raise ServiceError(404, "DOCUMENT_NOT_FOUND", f"Document {doc_id} is not part of {app_id}.")
        self.db.delete_document(doc_id)
        if d.get("storage_path"):
            (self.settings.data_dir / d["storage_path"]).unlink(missing_ok=True)
        self._after_documents_changed(app_id)

    # ------------------------------------------------------------------ runs

    def _pipeline_documents(self, app_id: str) -> List[Dict[str, Any]]:
        docs = []
        for d in self.db.list_documents(app_id):
            base = {"id": d["id"], "type": d["type"], "filename": d["filename"], "pages": d.get("page_count"),
                    "size_kb": self.public_document(d)["size_kb"], "uploaded_at": d.get("uploaded_at")}
            if d["source"] == "synthetic":
                meta = d.get("meta") or {}
                base.update(payload=meta.get("payload"), degrade=meta.get("degrade") or {}, pageMap=meta.get("pageMap") or {})
            else:
                base["_pages_text"] = self.db.get_document_text(d["id"]) or []
                base["source"] = "upload"
            docs.append(base)
        return docs

    @staticmethod
    def _request(header: Dict[str, Any]) -> Dict[str, Any]:
        return {k: v for k, v in header.items() if k not in _RUNTIME_KEYS}

    def _stage_listener(self, app_id: str, emit, paced: bool):
        async def on_stage(event: Dict[str, Any]) -> None:
            if event.get("id"):
                self._progress.setdefault(app_id, _blank_progress())[event["id"]] = event.get("status")
            await emit(event)
            if paced and self.settings.stage_pacing and event.get("status") == "RUNNING":
                await asyncio.sleep(STAGE_PACING.get(event.get("id"), 0.4))

        return on_stage

    def _set_status(self, app_id: str, status: str, **extra: Any) -> Dict[str, Any]:
        header = self.require_app(app_id)
        header.update(status=status, updated_at=now_iso(), **extra)
        self.db.save_application(header)
        return header

    def _commit(self, app_id: str, record: Dict[str, Any]) -> None:
        self.db.save_record(app_id, record)
        header = self.require_app(app_id)
        header.update(
            status=record.get("status"),
            decision=(record.get("decision") or {}).get("decision"),
            updated_at=record.get("generated_at") or now_iso(),
            last_error=None,
        )
        self.db.save_application(header)

    def start_underwriting(self, app_id: str, paced: bool = True) -> Dict[str, Any]:
        header = self.require_app(app_id)
        present = {d["type"] for d in self.db.list_documents(app_id)}
        missing = [t for t in REQUIRED_DOCS if t not in present]
        if missing:
            raise ServiceError(
                422, "MISSING_DOCUMENTS",
                "Underwriting needs every required document: " + ", ".join(DOC_LABELS[t] for t in missing) + ".",
                {"missing": missing},
            )
        holder: Dict[str, Any] = {}

        async def work(emit):
            job_id = holder["job"].id
            self._set_status(app_id, APP_STATUS.PROCESSING, last_job=job_id)
            self._progress[app_id] = _blank_progress()
            agent = AgentExtractionAdapter(self.provider) if self.provider is not None else None
            adapter = RoutedExtractionAdapter(agent=agent, segments=self.policy.get("segments"))
            try:
                record = await run_underwriting(
                    application=self._request(header),
                    documents=self._pipeline_documents(app_id),
                    policy=self.policy,
                    adapter=adapter,
                    on_stage=self._stage_listener(app_id, emit, paced),
                    execution={"n8n_execution_id": None, "workflow_version": WORKFLOW_VERSION, "runtime": "recaller-python", "job_id": job_id},
                )
                record["extraction_routes"] = adapter.routes
                self._commit(app_id, record)
                return record
            except Exception as exc:
                self._set_status(app_id, APP_STATUS.FAILED, last_error=f"{type(exc).__name__}: {exc}")
                raise

        try:
            holder["job"] = self.jobs.start(app_id, "underwrite", work)
        except JobConflict as exc:
            raise ServiceError(409, "JOB_RUNNING", str(exc)) from exc
        return holder["job"].public()

    def start_resume(self, app_id: str, resolutions: List[Dict[str, Any]], paced: bool = True) -> Dict[str, Any]:
        record = self.require_record(app_id)
        if record.get("status") != APP_STATUS.WAITING_FOR_OFFICER or not record.get("checkpoint"):
            raise ServiceError(409, "NOT_SUSPENDED", f"{app_id} is not waiting for officer review.")
        held = {h["path"] for h in (record.get("assist") or {}).get("queue", [])}
        given = {r["path"] for r in resolutions}
        unknown, unresolved = sorted(given - held), sorted(held - given)
        if unknown or unresolved:
            raise ServiceError(
                422, "RESOLUTIONS_INCOMPLETE",
                "Resolve every held field, and only held fields.",
                {"unknown": unknown, "unresolved": unresolved},
            )
        holder: Dict[str, Any] = {}

        async def work(emit):
            self._set_status(app_id, APP_STATUS.PROCESSING, last_job=holder["job"].id)
            self._progress[app_id] = self.progress_for(app_id, record)
            try:
                nxt = await resume_underwriting(
                    record=record, resolutions=resolutions, policy=self.policy,
                    on_stage=self._stage_listener(app_id, emit, paced),
                )
                self._commit(app_id, nxt)
                return nxt
            except Exception as exc:
                self._set_status(app_id, APP_STATUS.FAILED, last_error=f"{type(exc).__name__}: {exc}")
                raise

        try:
            holder["job"] = self.jobs.start(app_id, "resume", work)
        except JobConflict as exc:
            raise ServiceError(409, "JOB_RUNNING", str(exc)) from exc
        return holder["job"].public()

    async def replay(self, app_id: str, policy: Optional[Dict[str, Any]], label: str) -> Dict[str, Any]:
        record = self.require_record(app_id, decided=True)
        result = await replay_run(record=record, policy=policy or self.policy, label=label)
        self.db.add_replay(app_id, result)
        return result

    def what_if(self, app_id: str, target: str) -> Dict[str, Any]:
        return run_what_if(record=self.require_record(app_id, decided=True), policy=self.policy, target=target)

    def simulate(self, app_id: str, scenario: Dict[str, Any]) -> Dict[str, Any]:
        return run_simulation(record=self.require_record(app_id, decided=True), policy=self.policy, scenario=scenario)

    def verify_audit(self, app_id: str) -> Dict[str, Any]:
        record = self.require_record(app_id)
        ledger = record.get("audit") or {"events": []}
        return {**verify_ledger(ledger), "events": len(ledger.get("events", [])), "head": ledger.get("head"), "trace_id": ledger.get("traceId")}

    # ------------------------------------------------------------------ agents

    def start_agent_run(self, app_id: str, kind: str) -> Dict[str, Any]:
        if self.provider is None:
            raise ServiceError(
                503, "LLM_NOT_CONFIGURED",
                "No model is configured. Set ANTHROPIC_API_KEY (or RECALLER_LLM_PROVIDER=anthropic) and restart. "
                "Underwriting itself is fully deterministic and does not need one.",
            )
        record = self.require_record(app_id, decided=True)
        if any(r["status"] == "RUNNING" and r["kind"] == kind for r in self.db.list_agent_runs(app_id)):
            raise ServiceError(409, "AGENT_RUNNING", f"A {kind} run is already in progress for {app_id}.")
        run = {
            "id": f"AGR-{uuid.uuid4().hex[:10]}",
            "app_id": app_id,
            "kind": kind,
            "status": "RUNNING",
            "provider": getattr(self.provider, "name", "custom"),
            "model": getattr(self.provider, "model", None),
            "started_at": now_iso(),
        }
        self.db.save_agent_run(run)
        self._agent_tasks[run["id"]] = asyncio.create_task(self._agent_work(run, record))
        return run

    async def _agent_work(self, run: Dict[str, Any], record: Dict[str, Any]) -> None:
        try:
            fn = review_file if run["kind"] == "review" else explain_decision
            run["output"] = await fn(self.provider, record)
            run["status"] = "DONE"
        except Exception as exc:
            run["status"] = "FAILED"
            run["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            run["finished_at"] = now_iso()
            self.db.save_agent_run(run)
            self._agent_tasks.pop(run["id"], None)
            self.jobs.publish(run["app_id"], {"type": "agent", "run_id": run["id"], "kind": run["kind"], "status": run["status"]})

    async def wait_for_agents(self) -> None:
        if self._agent_tasks:
            await asyncio.gather(*self._agent_tasks.values(), return_exceptions=True)

    # ------------------------------------------------------------------ vocabulary

    def bootstrap(self) -> Dict[str, Any]:
        from ..core.audit import STAGE_LABELS
        from ..core.constants import DECISIONS, ENGINE_VERSION, PROVENANCE, STATUS_LABELS

        return {
            "engine_version": ENGINE_VERSION,
            "workflow_version": WORKFLOW_VERSION,
            "policy": self.policy,
            "policy_hash": self.policy_hash,
            "stage_plan": STAGE_PLAN,
            "applications": self.list_applications(),
            "vocab": {
                "status_labels": STATUS_LABELS,
                "doc_labels": DOC_LABELS,
                "required_docs": REQUIRED_DOCS,
                "optional_docs": OPTIONAL_DOCS,
                "provenance": {k: v for k, v in vars(PROVENANCE).items() if not k.startswith("_")},
                "decisions": list(DECISIONS.ALL),
                "stage_labels": STAGE_LABELS,
            },
            "limits": {"max_upload_mb": self.settings.max_upload_mb, "accepted_types": ["application/pdf", "text/plain", "image/png", "image/jpeg"]},
            "llm": self.status()["llm"],
        }
