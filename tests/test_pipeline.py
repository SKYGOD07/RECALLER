"""RECALLER — full pipeline verification tests (Python port of scripts/verify-pipeline.mjs)."""

import asyncio
import json
from pathlib import Path
import unittest

from recaller.core.audit import verify_ledger
from recaller.core.money import format_inr, format_pct
from recaller.orchestrator.pipeline import (
    replay,
    resume_underwriting,
    run_underwriting,
    run_what_if,
)
from recaller.synthetic.data import SYNTHETIC_APPLICATIONS

ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = ROOT / "policy" / "policy.v1.json"


class TestRecallerPipeline(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with open(POLICY_PATH, "r", encoding="utf-8") as f:
            cls.policy = json.load(f)

    async def test_all_synthetic_applications(self):
        for app in SYNTHETIC_APPLICATIONS:
            header = {k: v for k, v in app.items() if k not in ("documents", "scenario")}
            documents = app["documents"]

            record = await run_underwriting(
                application=header,
                documents=documents,
                policy=self.policy,
                now=header.get("created_at"),
            )

            if record["status"] == "WAITING_FOR_OFFICER":
                resolutions = [
                    {
                        "path": h["path"],
                        "action": "CONFIRM",
                        "by": header.get("officer"),
                        "at": header.get("created_at"),
                        "note": "Verified against original document at counter",
                    }
                    for h in record["assist"]["queue"]
                ]
                record = await resume_underwriting(
                    record=record,
                    resolutions=resolutions,
                    policy=self.policy,
                    now=header.get("created_at"),
                )

            # 1. Audit ledger integrity
            ledger_check = verify_ledger(record["audit"])
            self.assertTrue(
                ledger_check["ok"],
                f"Audit chain broken for {header['id']} at {ledger_check['brokenAt']}: {ledger_check['reason']}",
            )

            # 2. Replay determinism
            rp = await replay(record=record, policy=self.policy)
            self.assertTrue(
                rp["identical"],
                f"Replay diverged for {header['id']}: {json.dumps(rp['diff'])}",
            )

            # 3. What-if feasibility
            if record["decision"]["decision"] != "APPROVE":
                wi = run_what_if(record=record, policy=self.policy)
                self.assertIsNotNone(wi)


if __name__ == "__main__":
    unittest.main()
