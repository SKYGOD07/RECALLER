"""RECALLER — background underwriting jobs and their event streams.

A run (underwrite, resume) executes as an asyncio task; the HTTP request that
started it returns ``202 Accepted`` immediately. Stage events fan out to every
subscriber of that application, which is what the Server-Sent Events endpoint
streams to the console. One running job per application at a time.
"""

from __future__ import annotations

import asyncio
import itertools
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

from .db import now_iso

_ids = itertools.count(1)


@dataclass
class Job:
    id: str
    app_id: str
    kind: str
    status: str = "RUNNING"  # RUNNING | DONE | FAILED
    started_at: str = field(default_factory=now_iso)
    finished_at: Optional[str] = None
    error: Optional[str] = None
    result_status: Optional[str] = None
    events: List[Dict[str, Any]] = field(default_factory=list)
    task: Optional[asyncio.Task] = None

    def public(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "app_id": self.app_id,
            "kind": self.kind,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "result_status": self.result_status,
            "events": len(self.events),
        }


class JobConflict(RuntimeError):
    pass


class JobManager:
    def __init__(self, history: int = 50) -> None:
        self._jobs: Dict[str, Job] = {}
        self._by_app: Dict[str, Job] = {}
        self._subs: Dict[str, Set[asyncio.Queue]] = {}
        self._history = history

    def running(self, app_id: str) -> Optional[Job]:
        job = self._by_app.get(app_id)
        return job if job and job.status == "RUNNING" else None

    def latest(self, app_id: str) -> Optional[Job]:
        return self._by_app.get(app_id)

    def start(self, app_id: str, kind: str, work: Callable[[Callable[[Dict[str, Any]], Awaitable[None]]], Awaitable[Any]]) -> Job:
        if self.running(app_id):
            raise JobConflict(f"{app_id} already has a {self._by_app[app_id].kind} job running.")
        job = Job(id=f"JOB-{next(_ids):05d}", app_id=app_id, kind=kind)
        self._jobs[job.id] = job
        self._by_app[app_id] = job
        job.task = asyncio.create_task(self._run(job, work), name=job.id)
        self._trim()
        return job

    async def _run(self, job: Job, work) -> None:
        async def emit(event: Dict[str, Any]) -> None:
            self.publish(job.app_id, {"type": "stage", "job_id": job.id, **event})

        self.publish(job.app_id, {"type": "job", "job_id": job.id, "kind": job.kind, "status": "RUNNING"})
        try:
            result = await work(emit)
            job.result_status = result.get("status") if isinstance(result, dict) else None
            job.status = "DONE"
        except Exception as exc:  # the failure is reported on the stream and in diagnostics
            job.status = "FAILED"
            job.error = f"{type(exc).__name__}: {exc}"
        finally:
            job.finished_at = now_iso()
            self.publish(
                job.app_id,
                {"type": "end", "job_id": job.id, "status": job.status, "result_status": job.result_status, "error": job.error},
            )

    def publish(self, app_id: str, event: Dict[str, Any]) -> None:
        event = {"at": now_iso(), **event}
        job = self._by_app.get(app_id)
        if job is not None:
            job.events.append(event)
            del job.events[:-300]
        for q in list(self._subs.get(app_id, ())):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def subscribe(self, app_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subs.setdefault(app_id, set()).add(q)
        return q

    def unsubscribe(self, app_id: str, q: asyncio.Queue) -> None:
        self._subs.get(app_id, set()).discard(q)

    def subscriber_count(self) -> int:
        return sum(len(s) for s in self._subs.values())

    def list(self) -> List[Dict[str, Any]]:
        return [j.public() for j in sorted(self._jobs.values(), key=lambda j: j.started_at, reverse=True)]

    async def wait(self, app_id: str) -> None:
        job = self._by_app.get(app_id)
        if job and job.task:
            await asyncio.shield(job.task)

    async def cancel_all(self) -> None:
        for job in self._jobs.values():
            if job.task and not job.task.done():
                job.task.cancel()

    def _trim(self) -> None:
        done = [j for j in sorted(self._jobs.values(), key=lambda j: j.started_at) if j.status != "RUNNING"]
        for j in done[: max(0, len(self._jobs) - self._history)]:
            self._jobs.pop(j.id, None)
