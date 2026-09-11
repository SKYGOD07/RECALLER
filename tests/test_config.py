"""Configuration: every tunable comes from the environment / .env, over one table of defaults."""

import asyncio
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from recaller.ai.hermes import OllamaProvider, ProviderError, ScriptedProvider, check_provider, provider_from_env, provider_status
from recaller.ai.hermes.providers import cloud_model_name, parse_think
from recaller.app.server import create_app
from recaller.config import DEFAULTS, ConfigError, Settings, effective_config, get_int, stage_seconds

ROOT = Path(__file__).resolve().parent.parent
FORM = {"borrower_name": "Asha Verma", "segment": "EV_2W", "loan_amount": 95000, "tenure_months": 36, "declared_monthly_income": 38000}
NEMOTRON = {"RECALLER_LLM_PROVIDER": "ollama", "OLLAMA_API_KEY": "k", "RECALLER_LLM_MODEL": "nemotron-3-ultra:cloud"}


def settings_for(tmp: str, **overrides) -> Settings:
    data = Path(tmp)
    (data / "uploads").mkdir(parents=True, exist_ok=True)
    return Settings(
        root=ROOT, data_dir=data, db_path=data / "t.sqlite3", uploads_dir=data / "uploads",
        policy_path=ROOT / "policy" / "policy.v1.json", app_dist=data / "no-dist",
        max_upload_mb=2, stage_pacing=False, cors_origins=[], **overrides,
    )


class TestSettings(unittest.TestCase):
    def test_environment_overrides_the_default(self):
        self.assertEqual(get_int("RECALLER_PORT", {}), int(DEFAULTS["RECALLER_PORT"]))
        self.assertEqual(get_int("RECALLER_PORT", {"RECALLER_PORT": "9000"}), 9000)
        with self.assertRaises(ConfigError):
            get_int("RECALLER_PORT", {"RECALLER_PORT": "nine"})

    def test_effective_config_reports_source_and_holds_no_secrets(self):
        cfg = effective_config({"RECALLER_PORT": "9000", "OLLAMA_API_KEY": "secret-key"})
        self.assertEqual(cfg["RECALLER_PORT"], {"value": "9000", "source": "set"})
        self.assertEqual(cfg["RECALLER_HOST"]["source"], "default")
        self.assertNotIn("OLLAMA_API_KEY", cfg)
        self.assertNotIn("secret-key", str(cfg))

    def test_stage_pacing_overrides_only_the_named_stages(self):
        paced = stage_seconds({"RECALLER_STAGE_PACING_SECONDS": "bank=3"})
        self.assertEqual(paced["BANK"], 3.0)
        self.assertEqual(paced["KYC"], stage_seconds({})["KYC"])
        with self.assertRaises(ConfigError):
            stage_seconds({"RECALLER_STAGE_PACING_SECONDS": "BANK"})

    def test_app_id_format_is_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(settings_for(tmp, app_id_format="LN-{seq:05d}").format_app_id(7), "LN-00007")
            with self.assertRaises(ConfigError):
                settings_for(tmp, app_id_format="LN-FIXED")
            with self.assertRaises(ConfigError):
                settings_for(tmp, app_id_format="LN-{branch}-{seq}")


class TestOllamaCloud(unittest.TestCase):
    def test_a_key_without_a_host_means_cloud_and_the_daemon_suffix_is_dropped(self):
        status = provider_status(NEMOTRON)
        self.assertEqual((status["host"], status["cloud"], status["model"]), (DEFAULTS["RECALLER_OLLAMA_CLOUD_HOST"], True, "nemotron-3-ultra"))
        self.assertEqual(len(status["warnings"]), 1)  # the rename is reported, not silent
        provider = provider_from_env(NEMOTRON)
        self.assertEqual((provider.host, provider.model, provider.api_key), ("https://ollama.com", "nemotron-3-ultra", "k"))

    def test_cloud_without_a_key_warns(self):
        status = provider_status({"RECALLER_LLM_PROVIDER": "ollama", "OLLAMA_HOST": "https://ollama.com"})
        self.assertFalse(status["credentials_detected"])
        self.assertTrue(any("OLLAMA_API_KEY" in w for w in status["warnings"]))

    def test_names_and_think(self):
        self.assertEqual(cloud_model_name("gpt-oss:120b-cloud"), "gpt-oss:120b")
        self.assertEqual(cloud_model_name("nemotron-3-ultra"), "nemotron-3-ultra")
        self.assertEqual([parse_think(v) for v in ("", "false", "high")], [None, False, "high"])
        with self.assertRaises(ConfigError):
            parse_think("maybe")

    def test_think_is_sent_and_thinking_is_kept_out_of_the_answer(self):
        class Capture(OllamaProvider):
            async def _post(self, path, body):
                self.body = body
                return {"message": {"content": "<think>the total is 42</think>{\"ok\": true}", "thinking": "..."}}

        p = Capture(think=False)
        reply = asyncio.run(p.complete(system="", messages=[], tools=[]))
        self.assertIs(p.body["think"], False)
        self.assertEqual(reply.content, '{"ok": true}')
        self.assertNotIn("think", Capture().__dict__.get("body", {}))

    def test_check_provider_returns_the_reply(self):
        result = asyncio.run(check_provider(ScriptedProvider([{"content": " Ready. "}])))
        self.assertEqual((result["ok"], result["reply"], result["provider"]), (True, "Ready.", "scripted"))


class TestRateLimits(unittest.TestCase):
    def test_rate_limits_are_retried_then_reported(self):
        class Flaky(OllamaProvider):
            calls = 0

            async def _post_once(self, path, body):
                Flaky.calls += 1
                if Flaky.calls < 3:
                    raise ProviderError("Rate limited by Ollama; retry shortly.", status=429, retryable=True, retry_after=0.01)
                return {"message": {"content": "ok"}}

        reply = asyncio.run(Flaky(max_retries=4).complete(system="", messages=[], tools=[]))
        self.assertEqual((reply.content, Flaky.calls), ("ok", 3))

        Flaky.calls = 0
        with self.assertRaises(ProviderError) as ctx:
            asyncio.run(Flaky(max_retries=1).complete(system="", messages=[], tools=[]))
        self.assertIn("gave up after 1 retries", str(ctx.exception))

    def test_limits_come_from_config(self):
        p = provider_from_env({**NEMOTRON, "RECALLER_LLM_RETRIES": "0", "RECALLER_LLM_CONCURRENCY": "1"})
        self.assertEqual((p.max_retries, p._gate._value), (0, 1))


class TestApiReadsSettings(unittest.TestCase):
    def test_new_application_ids_follow_the_configured_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            with TestClient(create_app(settings_for(tmp, app_id_format="T-{seq}", app_sequence_start=41), provider=None)) as c:
                self.assertEqual(c.post("/api/applications", json=FORM).json()["id"], "T-42")
                self.assertEqual(c.post("/api/applications", json=FORM).json()["id"], "T-43")

    def test_model_check_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            with TestClient(create_app(settings_for(tmp), provider=None)) as c:
                r = c.post("/api/diagnostics/llm")
                self.assertEqual((r.status_code, r.json()["error"]["code"]), (503, "LLM_NOT_CONFIGURED"))
                self.assertIn("tunables", c.get("/api/diagnostics/config").json())
            with TestClient(create_app(settings_for(tmp), provider=ScriptedProvider([{"content": "Ready."}]))) as c:
                r = c.post("/api/diagnostics/llm")
                self.assertEqual((r.status_code, r.json()["reply"]), (200, "Ready."))


if __name__ == "__main__":
    unittest.main()
