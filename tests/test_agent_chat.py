"""Talking to the model about a file: tools, skill, reasoning and the numeric guard."""

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from recaller.ai.hermes import ModelReply, OllamaProvider, ScriptedProvider, unsupported_numbers
from recaller.app.server import create_app
from recaller.config import Settings

ROOT = Path(__file__).resolve().parent.parent


def settings_for(tmp: str) -> Settings:
    data = Path(tmp)
    (data / "uploads").mkdir(parents=True, exist_ok=True)
    return Settings(
        root=ROOT, data_dir=data, db_path=data / "t.sqlite3", uploads_dir=data / "uploads",
        policy_path=ROOT / "policy" / "policy.v1.json", app_dist=data / "no-dist",
        max_upload_mb=2, stage_pacing=False, cors_origins=[],
    )


class TestAsk(unittest.TestCase):
    def test_reasoning_is_kept_apart_from_the_answer(self):
        reply = OllamaProvider._to_reply({"message": {"content": "Answer.", "thinking": "FOIR is under the ceiling."}})
        self.assertEqual((reply.content, reply.thinking), ("Answer.", "FOIR is under the ceiling."))

    def test_ask_reads_the_record_and_flags_invented_figures(self):
        provider = ScriptedProvider(
            [
                {"tool_calls": [{"id": "c1", "name": "read_decision", "arguments": {}}]},
                ModelReply(content="It was approved; the EMI is 987654.", stop_reason="end_turn", thinking="Read the memo first."),
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            with TestClient(create_app(settings_for(tmp), provider=provider)) as c:
                early = c.post("/api/applications/RCL-2026-0418/agent/ask", json={"question": "Why?"})
                self.assertEqual(early.json()["error"]["code"], "NOT_UNDERWRITTEN")

                c.post("/api/applications/RCL-2026-0418/underwrite", json={"paced": False})
                r = c.post("/api/applications/RCL-2026-0418/agent/ask", json={"question": "Why was this approved?"})
                self.assertEqual(r.status_code, 200, r.text)
                out = r.json()["output"]
                self.assertEqual(out["tool_calls"][0]["name"], "read_decision")
                self.assertIn("credit-underwriter", provider.calls[0]["system"])
                self.assertFalse(out["grounded"])
                self.assertIn(987654.0, out["unsupported_numbers"])
                self.assertEqual(out["reasoning"], "Read the memo first.")
                runs = c.get("/api/applications/RCL-2026-0418/agent-runs").json()
                self.assertEqual([x["kind"] for x in runs], ["ask"])

                self.assertEqual(c.post("/api/applications/RCL-2026-0418/agent/ask", json={"question": ""}).status_code, 422)


class TestNumericGuard(unittest.TestCase):
    def test_scaled_restatements_pass_and_invented_figures_do_not(self):
        allowed = [90000.0, 420000.0, 212000.0, 0.271]
        # Seen live from Nemotron: "₹212,000 in [₹90k–₹420k]".
        self.assertEqual(unsupported_numbers("₹212,000 in [₹90k–₹420k]; 2.12 lakh; FOIR 27.1%", allowed), [])
        self.assertEqual(unsupported_numbers("The EMI is 987654.", allowed), [987654.0])


class TestRestart(unittest.TestCase):
    def test_runs_left_running_by_a_dead_server_are_failed_on_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = create_app(settings_for(tmp), provider=None)
            with TestClient(first):
                first.state.service.db.save_agent_run(
                    {"id": "AGR-orphan", "app_id": "RCL-2026-0418", "kind": "review", "status": "RUNNING"}
                )
            with TestClient(create_app(settings_for(tmp), provider=None)) as c:
                run = c.get("/api/applications/RCL-2026-0418/agent-runs").json()[0]
                self.assertEqual(run["status"], "FAILED")
                self.assertIn("Interrupted", run["error"])


if __name__ == "__main__":
    unittest.main()
