"""RECALLER — FastAPI server exposing underwriting services and serving console."""

from contextlib import asynccontextmanager
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..core.constants import ENGINE_VERSION, WORKFLOW_VERSION
from ..orchestrator.pipeline import STAGE_PLAN
from .store import AppStore

import sys

if getattr(sys, "frozen", False):
    ROOT = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
else:
    ROOT = Path(__file__).resolve().parent.parent.parent

POLICY_PATH = ROOT / "policy" / "policy.v1.json"
if not POLICY_PATH.exists():
    alt_policy = Path(__file__).resolve().parent.parent.parent / "policy" / "policy.v1.json"
    if alt_policy.exists():
        POLICY_PATH = alt_policy

APP_DIST_PATH = ROOT / "app" / "dist"
if not APP_DIST_PATH.exists():
    alt_dist = Path(__file__).resolve().parent.parent.parent / "app" / "dist"
    if alt_dist.exists():
        APP_DIST_PATH = alt_dist


def load_policy() -> Dict[str, Any]:
    with open(POLICY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


policy_doc = load_policy()
store = AppStore(policy_doc)


class CreateAppRequest(BaseModel):
    form: Dict[str, Any]
    documents: List[Dict[str, Any]] = []


class UnderwriteRequest(BaseModel):
    paced: bool = True


class ResumeRequest(BaseModel):
    resolutions: List[Dict[str, Any]] = []
    paced: bool = True


class ReplayRequest(BaseModel):
    policy: Optional[Dict[str, Any]] = None
    label: str = "Replay with original policy"


class WhatIfRequest(BaseModel):
    target: Optional[str] = "APPROVE"


class SimulateRequest(BaseModel):
    scenario: Dict[str, Any]


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="RECALLER API", version=ENGINE_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "workflow_version": WORKFLOW_VERSION,
    }


@app.get("/api/policy")
async def get_policy():
    return store.policy


@app.get("/api/stage-plan")
async def get_stage_plan():
    return STAGE_PLAN


@app.get("/api/applications")
async def list_applications():
    return store.list_applications()


@app.get("/api/applications/{app_id}")
async def get_application(app_id: str):
    header = store.get_application(app_id)
    if not header:
        raise HTTPException(status_code=404, detail=f"Application {app_id} not found")
    return {
        "application": header,
        "documents": store.get_documents(app_id),
        "record": store.get_record(app_id),
        "progress": store.get_progress(app_id),
        "replays": store.get_replays(app_id),
    }


@app.post("/api/applications")
async def create_application(req: CreateAppRequest):
    app_id = store.create_application(req.form, req.documents)
    return {"id": app_id, "application": store.get_application(app_id)}


@app.post("/api/applications/{app_id}/underwrite")
async def start_underwriting_endpoint(app_id: str, req: Optional[UnderwriteRequest] = None):
    paced = req.paced if req else True
    try:
        record = await store.start_underwriting(app_id, paced=paced)
        return record
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/applications/{app_id}/resume")
async def resume_underwriting_endpoint(app_id: str, req: ResumeRequest):
    try:
        record = await store.resume_underwriting(app_id, req.resolutions, paced=req.paced)
        return record
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/applications/{app_id}/replay")
async def replay_endpoint(app_id: str, req: Optional[ReplayRequest] = None):
    policy_override = req.policy if req else None
    label = req.label if req else "Replay with original policy"
    try:
        res = await store.replay_application(app_id, policy_override=policy_override, label=label)
        return res
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/applications/{app_id}/whatif")
async def what_if_endpoint(app_id: str, req: Optional[WhatIfRequest] = None):
    target = req.target if req else "APPROVE"
    res = store.solve_what_if(app_id, target=target)
    if res is None:
        raise HTTPException(status_code=400, detail=f"Cannot run what-if on {app_id}")
    return res


@app.post("/api/applications/{app_id}/simulate")
async def simulate_endpoint(app_id: str, req: SimulateRequest):
    res = store.simulate_scenario(app_id, req.scenario)
    if res is None:
        raise HTTPException(status_code=400, detail=f"Cannot run simulation on {app_id}")
    return res


@app.post("/api/reset")
async def reset_endpoint():
    store.reset_console()
    return {"ok": True, "applications": store.list_applications()}


# Mount built frontend console if exists
if APP_DIST_PATH.exists() and (APP_DIST_PATH / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(APP_DIST_PATH / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = APP_DIST_PATH / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(APP_DIST_PATH / "index.html")
