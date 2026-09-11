"""RECALLER console — state store and orchestration coordinator."""

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional

from ..core.constants import APP_STATUS
from ..orchestrator.pipeline import (
    STAGE_PLAN,
    replay as replay_run,
    resume_underwriting as resume_run,
    run_simulation,
    run_underwriting,
    run_what_if,
)
from ..synthetic.data import SYNTHETIC_APPLICATIONS

STAGE_PACING = {
    "INGEST": 0.38,
    "KYC": 0.90,
    "BANK": 1.50,
    "PLATFORM": 0.85,
    "INVOICE": 0.78,
    "VALIDATE": 0.42,
    "RECONCILE": 0.62,
    "GATE": 0.34,
    "CREDIT": 0.52,
    "POLICY": 0.46,
    "DECISION": 0.38,
    "MEMO": 0.70,
}


def blank_progress() -> Dict[str, str]:
    return {s["id"]: "PENDING" for s in STAGE_PLAN}


class AppStore:
    def __init__(self, policy: Dict[str, Any]):
        self.policy = policy
        self.applications: Dict[str, Dict[str, Any]] = {}
        self.bundles: Dict[str, List[Dict[str, Any]]] = {}
        self.records: Dict[str, Dict[str, Any]] = {}
        self.progress: Dict[str, Dict[str, str]] = {}
        self.replays: Dict[str, List[Dict[str, Any]]] = {}
        self.sequence = 500
        self.seed()

    def seed(self) -> None:
        for app in SYNTHETIC_APPLICATIONS:
            header = {k: v for k, v in app.items() if k not in ("documents", "scenario")}
            app_id = app["id"]
            self.applications[app_id] = {
                **header,
                "scenario": app.get("scenario"),
                "status": APP_STATUS.DRAFT,
                "decision": None,
                "updated_at": header.get("created_at"),
                "custom": False,
                "document_count": len(app.get("documents", [])),
            }
            self.bundles[app_id] = app.get("documents", [])
            self.progress[app_id] = blank_progress()

    def reset_console(self) -> None:
        self.records.clear()
        self.replays.clear()
        custom_ids = [k for k, v in self.applications.items() if v.get("custom")]
        for cid in custom_ids:
            self.applications.pop(cid, None)
            self.bundles.pop(cid, None)
            self.progress.pop(cid, None)

        self.seed()

    def list_applications(self) -> List[Dict[str, Any]]:
        return list(self.applications.values())

    def get_application(self, app_id: str) -> Optional[Dict[str, Any]]:
        return self.applications.get(app_id)

    def get_documents(self, app_id: str) -> List[Dict[str, Any]]:
        docs = self.bundles.get(app_id, [])
        return [{k: v for k, v in d.items() if k not in ("payload", "degrade")} for d in docs]

    def get_record(self, app_id: str) -> Optional[Dict[str, Any]]:
        return self.records.get(app_id)

    def get_progress(self, app_id: str) -> Dict[str, str]:
        return self.progress.get(app_id, blank_progress())

    def get_replays(self, app_id: str) -> List[Dict[str, Any]]:
        return self.replays.get(app_id, [])

    def create_application(
        self, form: Dict[str, Any], documents: List[Dict[str, Any]]
    ) -> str:
        self.sequence += 1
        app_id = f"RCL-2026-0{self.sequence}"
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        header = {
            "id": app_id,
            "borrower_name": form.get("borrower_name"),
            "segment": form.get("segment"),
            "loan_amount": float(form.get("loan_amount", 0)),
            "tenure_months": int(float(form.get("tenure_months", 0))),
            "declared_monthly_income": float(form.get("declared_monthly_income", 0)),
            "branch": form.get("branch"),
            "officer": form.get("officer"),
            "dealer": form.get("dealer"),
            "occupation": form.get("occupation"),
            "created_at": now_iso,
            "status": APP_STATUS.DRAFT,
            "decision": None,
            "updated_at": now_iso,
            "custom": True,
            "document_count": len(documents),
        }
        self.applications[app_id] = header
        self.bundles[app_id] = documents
        self.progress[app_id] = blank_progress()
        return app_id

    def commit_record(self, app_id: str, record: Dict[str, Any]) -> None:
        self.records[app_id] = record
        header = self.applications.get(app_id, {})
        decision_val = record.get("decision", {}).get("decision") if record.get("decision") else None
        now_iso = record.get("generated_at") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        self.applications[app_id] = {
            **header,
            "status": record.get("status"),
            "decision": decision_val,
            "updated_at": now_iso,
        }

        prog = blank_progress()
        completed = record.get("checkpoint", {}).get("completed_stages") if record.get("checkpoint") else [s["id"] for s in STAGE_PLAN]
        if completed:
            for s in completed:
                prog[s] = "DONE"
        if record.get("status") == APP_STATUS.WAITING_FOR_OFFICER:
            prog["GATE"] = "HELD"
        self.progress[app_id] = prog

    async def start_underwriting(
        self,
        app_id: str,
        paced: bool = True,
        on_stage_callback: Optional[Callable[..., Any]] = None,
    ) -> Dict[str, Any]:
        header = self.applications.get(app_id)
        documents = self.bundles.get(app_id)
        if not header or documents is None:
            raise ValueError(f"Unknown application {app_id}")

        self.applications[app_id]["status"] = APP_STATUS.PROCESSING
        self.progress[app_id] = blank_progress()

        async def stage_listener(event: Dict[str, Any]) -> None:
            stage_id = event.get("id")
            status = event.get("status")
            if stage_id:
                self.progress[app_id][stage_id] = status
            if on_stage_callback:
                await on_stage_callback(event)
            if paced and status == "RUNNING":
                delay = STAGE_PACING.get(stage_id, 0.4)
                await asyncio.sleep(delay)

        app_req = {k: v for k, v in header.items() if k not in ("scenario", "status", "decision", "updated_at", "custom", "document_count")}
        record = await run_underwriting(
            application=app_req,
            documents=documents,
            policy=self.policy,
            on_stage=stage_listener,
        )

        self.commit_record(app_id, record)
        return record

    async def resume_underwriting(
        self,
        app_id: str,
        resolutions: List[Dict[str, Any]],
        paced: bool = True,
        on_stage_callback: Optional[Callable[..., Any]] = None,
    ) -> Dict[str, Any]:
        record = self.records.get(app_id)
        if not record:
            raise ValueError(f"No suspended execution for {app_id}")

        self.applications[app_id]["status"] = APP_STATUS.PROCESSING

        async def stage_listener(event: Dict[str, Any]) -> None:
            stage_id = event.get("id")
            status = event.get("status")
            if stage_id:
                self.progress[app_id][stage_id] = status
            if on_stage_callback:
                await on_stage_callback(event)
            if paced and status == "RUNNING":
                delay = STAGE_PACING.get(stage_id, 0.4)
                await asyncio.sleep(delay)

        next_rec = await resume_run(
            record=record,
            resolutions=resolutions,
            policy=self.policy,
            on_stage=stage_listener,
        )

        self.commit_record(app_id, next_rec)
        return next_rec

    async def replay_application(
        self,
        app_id: str,
        policy_override: Optional[Dict[str, Any]] = None,
        label: str = "Replay with original policy",
    ) -> Dict[str, Any]:
        record = self.records.get(app_id)
        if not record:
            raise ValueError(f"Nothing to replay for {app_id}")
        pol = policy_override or self.policy
        res = await replay_run(record=record, policy=pol, label=label)
        cur_replays = self.replays.get(app_id, [])
        self.replays[app_id] = [res, *cur_replays][:12]
        return res

    def solve_what_if(self, app_id: str, target: Optional[str] = None) -> Optional[Dict[str, Any]]:
        record = self.records.get(app_id)
        if not record or not record.get("credit"):
            return None
        return run_what_if(record=record, policy=self.policy, target=target)

    def simulate_scenario(self, app_id: str, scenario: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        record = self.records.get(app_id)
        if not record or not record.get("credit"):
            return None
        return run_simulation(record=record, policy=self.policy, scenario=scenario)
