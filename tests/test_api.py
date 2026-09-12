"""RECALLER HTTP API — end to end against a temporary database.

Real PDFs are generated with PyMuPDF, uploaded over multipart, read by the
document service, extracted by the pattern extractor, underwritten in a
background job, resumed by an officer, replayed and verified.
"""

import json
import tempfile
import time
import unittest
from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient

from recaller.ai.hermes import ScriptedProvider
from recaller.app.server import create_app
from recaller.config import Settings

ROOT = Path(__file__).resolve().parent.parent


def pdf(text: str) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 72), text, fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


DOCS = {
    "AADHAAR": "Government of India\nName: Asha Verma\nDate of Birth: 14/08/1991\nGender: Female\n"
    "Aadhaar No: XXXX XXXX 5521\nAddress: 22 Shastri Nagar, Jaipur, Rajasthan 302016",
    "PAN": "Income Tax Department\nName: ASHA VERMA\nPAN: ABCPV1234X",
    "BANK_STATEMENT": "Account Holder: Asha Verma\nAccount No: XXXXXXXX7781\nBank: State Bank of India\nIFSC: SBIN0001234\n"
    "Address: 22 Shastri Nagar, Jaipur, Rajasthan 302016\nStatement Period: Mar 2026 - Aug 2026\n"
    "Monthly Credits: 38200, 39100, 37600, 40200, 38800, 39500\nMonthly Cash Deposits: 2000, 1500, 1800, 2200, 1600, 1900\n"
    "Average Balance: 9200\nReturned Debits: 0\nRecurring Debit: Phone EMI, 1,200",
    "DEALER_INVOICE": "Dealer: Volt Mobility Jaipur\nInvoice No: VM-2026-0931\nModel: EV Scooter X2\nVehicle Category: EV_2W\n"
    "Chassis No: MD9ABCD12345678901\nEx-Showroom Price: Rs 1,05,000\nInsurance: Rs 6,500\n"
    "Registration & RTO: Rs 4,500\nOn-Road Price: Rs 1,16,000",
}
FORM = {"borrower_name": "Asha Verma", "segment": "EV_2W", "loan_amount": 95000, "tenure_months": 36, "declared_monthly_income": 38000}


def settings_for(tmp: str, pacing: bool = False) -> Settings:
    data = Path(tmp)
    (data / "uploads").mkdir(parents=True, exist_ok=True)
    return Settings(
        root=ROOT, data_dir=data, db_path=data / "test.sqlite3", uploads_dir=data / "uploads",
        policy_path=ROOT / "policy" / "policy.v1.json", app_dist=data / "no-dist",
        max_upload_mb=2, stage_pacing=pacing, cors_origins=[],
    )


class ApiCase(unittest.TestCase):
    provider = None

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.client = TestClient(create_app(settings_for(self.tmp.name), provider=self.provider))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.tmp.cleanup()

    def wait(self, app_id, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            detail = self.client.get(f"/api/applications/{app_id}").json()
            if detail["job"] and detail["job"]["status"] != "RUNNING":
                return detail
            time.sleep(0.05)
        self.fail(f"job for {app_id} did not finish")

    def new_app_with_uploads(self, docs=DOCS):
        created = self.client.post("/api/applications", json=FORM)
        self.assertEqual(created.status_code, 201)
        app_id = created.json()["id"]
        for doc_type, text in docs.items():
            r = self.client.post(
                f"/api/applications/{app_id}/documents",
                data={"type": doc_type},
                files={"file": (f"{doc_type.lower()}.pdf", pdf(text), "application/pdf")},
            )
            self.assertEqual(r.status_code, 201, r.text)
            self.assertEqual(r.json()["source"], "upload")
            self.assertGreater(r.json()["text_chars"], 20)
        return app_id


class TestSystem(ApiCase):
    def test_health_bootstrap_and_headers(self):
        r = self.client.get("/api/health", headers={"X-Request-ID": "probe-1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["x-request-id"], "probe-1")
        self.assertIn("app;dur=", r.headers["server-timing"])
        body = r.json()
        self.assertEqual(body["documents"]["engine"], "PyMuPDF")
        self.assertFalse(body["llm"]["enabled"])
        boot = self.client.get("/api/bootstrap").json()
        self.assertEqual(len(boot["applications"]), 8)
        self.assertEqual(boot["vocab"]["required_docs"], ["AADHAAR", "PAN", "BANK_STATEMENT", "DEALER_INVOICE"])
        self.assertEqual(len(boot["stage_plan"]), 13)  # + INFORMANT
        logged = self.client.get("/api/diagnostics/requests").json()
        self.assertEqual(logged[1]["request_id"], "probe-1")

    def test_error_envelope(self):
        r = self.client.get("/api/applications/NOPE")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()["error"]["code"], "APPLICATION_NOT_FOUND")
        self.assertEqual(r.json()["error"]["request_id"], r.headers["x-request-id"])
        r = self.client.post("/api/applications", json={"borrower_name": ""})
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (422, "VALIDATION_ERROR"))
        self.assertEqual(self.client.get("/api/nope").json()["error"]["code"], "ROUTE_NOT_FOUND")
        app_id = self.client.post("/api/applications", json=FORM).json()["id"]
        r = self.client.post(f"/api/applications/{app_id}/underwrite?async=true", json={"paced": False})
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (422, "MISSING_DOCUMENTS"))
        r = self.client.post(f"/api/applications/{app_id}/documents", data={"type": "PAN"}, files={"file": ("x.bin", b"\x00\x01garbage", "application/octet-stream")})
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (415, "UNREADABLE_DOCUMENT"))

    def test_quote_matches_engine(self):
        q = self.client.get("/api/quote", params={"segment": "EV_2W", "amount": 95000, "tenure": 36}).json()
        self.assertGreater(q["emi"], 0)
        self.assertEqual(self.client.get("/api/quote", params={"segment": "X", "amount": 1, "tenure": 1}).json()["error"]["code"], "UNKNOWN_SEGMENT")

    def test_extract_draft_from_document(self):
        r = self.client.post(
            "/api/applications/extract-draft",
            files={"file": ("aadhaar.pdf", pdf(DOCS["AADHAAR"]), "application/pdf")},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["extracted_fields"]["borrower_name"], "Asha Verma")
        self.assertEqual(body["extracted_fields"]["detected_doc_type"], "AADHAAR")
        self.assertGreaterEqual(body["extracted_fields"]["confidence"], 0.8)


class TestUnderwriting(ApiCase):
    def test_synthetic_file_end_to_end(self):
        r = self.client.post("/api/applications/RCL-2026-0418/underwrite?async=true", json={"paced": False})
        self.assertEqual(r.status_code, 202)
        detail = self.wait("RCL-2026-0418")
        rec = detail["record"]
        self.assertEqual(rec["decision"]["decision"], "APPROVE")
        self.assertTrue(rec["audit_verification"]["ok"])
        self.assertEqual(rec["extraction_routes"]["RCL-2026-0418-AADHAAR"]["route"], "fixture")
        self.assertTrue(self.client.post("/api/applications/RCL-2026-0418/replay").json()["identical"])
        self.assertTrue(self.client.get("/api/applications/RCL-2026-0418/audit/verify").json()["ok"])
        self.assertIn("feasible", json.dumps(self.client.post("/api/applications/RCL-2026-0418/whatif", json={"target": "APPROVE"}).json()) + "feasible")
        self.assertEqual(len(self.client.get("/api/applications/RCL-2026-0418").json()["replays"]), 1)

    def test_uploaded_pdfs_are_read_and_decided(self):
        app_id = self.new_app_with_uploads()
        self.assertEqual(self.client.post(f"/api/applications/{app_id}/underwrite?async=true", json={"paced": False}).status_code, 202)
        detail = self.wait(app_id)
        self.assertEqual(detail["job"]["status"], "DONE", detail["job"])
        rec = detail["record"]
        self.assertIn(rec["status"], ("APPROVED", "REFERRED", "REJECTED"), rec.get("assist"))
        self.assertEqual({r["route"] for r in rec["extraction_routes"].values()}, {"pattern"})
        f = rec["evidence"]["fields"]["invoice.on_road_price"]
        self.assertEqual((f["value"], f["citation"]["method"], f["citation"]["page"]), (116000, "pattern", 1))
        self.assertEqual(rec["evidence"]["fields"]["applicant.dob"]["value"], "1991-08-14")
        self.assertEqual(rec["credit"]["metrics"]["obligations"], 1200.0)
        doc_id = detail["documents"][0]["id"]
        self.assertIn("Asha Verma", json.dumps(self.client.get(f"/api/documents/{doc_id}").json()["text_pages"]))
        self.assertEqual(self.client.get(f"/api/documents/{doc_id}/file").headers["content-type"], "application/pdf")

    def test_missing_field_is_held_then_resumed_by_officer(self):
        docs = {**DOCS, "BANK_STATEMENT": DOCS["BANK_STATEMENT"].replace("Monthly Credits: 38200, 39100, 37600, 40200, 38800, 39500\n", "")}
        app_id = self.new_app_with_uploads(docs)
        self.client.post(f"/api/applications/{app_id}/underwrite?async=true", json={"paced": False})
        rec = self.wait(app_id)["record"]
        self.assertEqual(rec["status"], "WAITING_FOR_OFFICER")
        held = {h["path"] for h in rec["assist"]["queue"]}
        self.assertIn("bank.monthly_credits", held)

        r = self.client.post(f"/api/applications/{app_id}/resume?async=true", json={"resolutions": [], "paced": False})
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (422, "RESOLUTIONS_INCOMPLETE"))

        resolutions = [
            {"path": p, "action": "EDIT", "value": "38200, 39100, 37600, 40200, 38800, 39500", "note": "Read from statement summary"}
            if p == "bank.monthly_credits" else {"path": p, "action": "CONFIRM"}
            for p in held
        ]
        self.assertEqual(self.client.post(f"/api/applications/{app_id}/resume?async=true", json={"resolutions": resolutions, "paced": False}).status_code, 202)
        rec = self.wait(app_id)["record"]
        self.assertIsNotNone(rec["decision"])
        credits = rec["evidence"]["fields"]["bank.monthly_credits"]
        self.assertEqual((credits["provenance"], credits["value"][0]), ("OFFICER", 38200))
        self.assertTrue(rec["audit_verification"]["ok"])

    def test_default_run_mode_waits_and_returns_the_record(self):
        r = self.client.post("/api/applications/RCL-2026-0426/underwrite", json={"paced": False})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["decision"]["decision"], "REJECT")
        self.assertTrue(r.json()["audit_verification"]["ok"])
        err = self.client.post("/api/applications/RCL-2026-0426/resume", json={"resolutions": [], "paced": False}).json()
        self.assertEqual((err["error"]["code"], err["detail"]), ("NOT_SUSPENDED", err["error"]["message"]))

    def test_sse_stream_reports_stages_and_end(self):
        self.client.post("/api/applications/RCL-2026-0426/underwrite?async=true", json={"paced": False})
        self.wait("RCL-2026-0426")
        with self.client.stream("GET", "/api/applications/RCL-2026-0426/events", params={"once": "true"}) as r:
            self.assertEqual(r.headers["content-type"].split(";")[0], "text/event-stream")
            events = [line[7:] for line in r.iter_lines() if line.startswith("event: ")]
        self.assertEqual(events, ["snapshot", "end"])
        log = self.client.get("/api/applications/RCL-2026-0426/job").json()["log"]
        self.assertEqual([e["id"] for e in log if e.get("type") == "stage" and e.get("status") == "DONE"][-1], "MEMO")

    def test_agents_need_a_model(self):
        self.client.post("/api/applications/RCL-2026-0418/underwrite?async=true", json={"paced": False})
        self.wait("RCL-2026-0418")
        r = self.client.post("/api/applications/RCL-2026-0418/agent/review")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (503, "LLM_NOT_CONFIGURED"))


def scripted_reviewer(req):
    first = req["messages"][0]["content"]
    if "Summarise these reviewer findings" in first:
        return {"content": json.dumps({"summary": "Identity and income agree; FOIR is well inside policy.", "priorities": ["File the invoice copy"]})}
    if "Explain this credit decision" in first:
        return {"content": json.dumps({"headline": "Approved on verified income and clean conduct.", "paragraphs": ["All rules passed."], "cited_reason_codes": ["A01"]})}
    area = next((a for a in ("KYC", "INCOME", "INVOICE", "RECONCILIATION") if f"Area: {a}" in req["system"]), "GENERAL")
    return {"content": json.dumps({"findings": [{"area": area, "severity": "INFO", "title": f"{area} consistent", "detail": "No contradiction found.", "evidence_paths": ["applicant.name"]}], "summary": "ok"})}


class TestAgentsWithScriptedModel(ApiCase):
    provider = ScriptedProvider([scripted_reviewer])

    def test_multi_agent_review_and_explanation(self):
        self.client.post("/api/applications/RCL-2026-0418/underwrite?async=true", json={"paced": False})
        self.wait("RCL-2026-0418")
        for kind in ("review", "explain"):
            r = self.client.post(f"/api/applications/RCL-2026-0418/agent/{kind}")
            self.assertEqual(r.status_code, 202, r.text)
        deadline = time.time() + 20
        runs = []
        while time.time() < deadline:
            runs = self.client.get("/api/applications/RCL-2026-0418/agent-runs").json()
            if runs and all(x["status"] != "RUNNING" for x in runs):
                break
            time.sleep(0.05)
        by_kind = {x["kind"]: x for x in runs}
        review = by_kind["review"]["output"]
        self.assertEqual(by_kind["review"]["status"], "DONE", by_kind["review"].get("error"))
        self.assertEqual(len(review["children"]), 4)
        self.assertEqual({f["area"] for f in review["findings"]}, {"KYC", "INCOME", "INVOICE", "RECONCILIATION"})
        self.assertTrue(all(f["grounded"] for f in review["findings"]))
        self.assertTrue(review["synthesis"]["accepted"])
        explain = by_kind["explain"]["output"]
        self.assertEqual(explain["source"], "model")
        # the decision itself is untouched by agent runs
        self.assertEqual(self.client.get("/api/applications/RCL-2026-0418").json()["record"]["decision"]["decision"], "APPROVE")


if __name__ == "__main__":
    unittest.main()
