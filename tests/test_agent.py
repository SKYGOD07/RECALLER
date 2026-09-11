"""RECALLER — agent runtime tests (Python port of scripts/test-agent.mjs)."""

import json
from pathlib import Path
import re
import unittest

from recaller.agent.adapters.extraction import create_agent_extraction_adapter
from recaller.agent.adapters.narration import create_narration_stylist
from recaller.agent.delegate import delegate_task, register_delegate_tool
from recaller.agent.loop import run_agent
from recaller.agent.registry import create_registry, is_forbidden_tool_name
from recaller.agent.skills import parse_skill, skill_prompt
from recaller.agent.structured import generate_structured, validate
from recaller.agent.toolsets import resolve_toolset
from recaller.extraction.adapters import apply_confidence_gate, extract_bundle
from recaller.narration.memo import narrate

ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = ROOT / "policy" / "policy.v1.json"
SKILL_PATH = ROOT / "packages" / "agent" / "skills" / "credit-underwriter" / "SKILL.md"
EVIDENCE_RULES_PATH = (
    ROOT
    / "packages"
    / "agent"
    / "skills"
    / "credit-underwriter"
    / "references"
    / "evidence-rules.md"
)


def scripted(replies):
    calls = []
    i = 0

    async def model(req):
        nonlocal i
        calls.append({**req, "messages": list(req.get("messages", []))})
        r = replies[min(i, len(replies) - 1)]
        i += 1
        return r(req) if callable(r) else r

    model.calls = calls
    return model


def call_spec(name, args, call_id):
    return {"tool_calls": [{"id": call_id, "name": name, "arguments": args}]}


class TestRecallerAgent(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        with open(POLICY_PATH, "r", encoding="utf-8") as f:
            cls.policy = json.load(f)

    # 1. Registry Forbidden Tools
    def test_registry_boundaries(self):
        forbidden = [
            "approve_loan",
            "reject_application",
            "calculate_emi",
            "compute_foir",
            "set_policy",
            "override_decision",
            "refer_case",
        ]
        for name in forbidden:
            self.assertTrue(is_forbidden_tool_name(name), f"Expected {name} to be forbidden")
            reg = create_registry()
            with self.assertRaises(ValueError):
                reg.register(name=name, handler=lambda *_: None)

        allowed = [
            "read_decision",
            "record_evidence",
            "read_reference",
            "flag_issue",
            "delegate_task",
        ]
        for name in allowed:
            self.assertFalse(is_forbidden_tool_name(name), f"Expected {name} to be allowed")

        def throw_boom(*_):
            raise Exception("x" * 5000)

        reg_err = create_registry().register(name="boom", handler=throw_boom)

        async def check_err():
            out = json.loads(await reg_err.dispatch("boom", {}))
            self.assertTrue(len(out["error"]) < 2100 and out["error"].endswith("[truncated]"))

        import asyncio

        asyncio.run(check_err())

    # 2. Toolsets
    def test_toolsets(self):
        self.assertEqual(
            resolve_toolset("evidence"),
            ["read_document", "record_evidence", "flag_issue"],
        )
        self.assertEqual(
            sorted(resolve_toolset("supervisor")),
            ["delegate_task", "flag_issue", "read_evidence"],
        )

    # 3. Agent Loop
    async def test_loop(self):
        seen = []
        reg = create_registry()
        reg.register(
            name="echo",
            handler=lambda args, *_: seen.append(args) or {"echoed": args.get("text")},
        )
        reg.register(
            name="secret",
            handler=lambda *_: seen.append("secret") or "leaked",
        )

        model = scripted(
            [
                call_spec("echo", '{"text":"hi"}', "c1"),
                call_spec("secret", {}, "c2"),
                {"content": "done"},
            ]
        )
        run = await run_agent(
            model=model,
            registry=reg,
            tool_names=["echo"],
            messages=[{"role": "user", "content": "go"}],
        )

        self.assertEqual(run["exitReason"], "completed")
        self.assertEqual(seen[0], {"text": "hi"})
        self.assertNotIn("secret", seen)
        self.assertTrue(re.search(r"not available.*echo", run["toolCalls"][1]["result"]))
        self.assertEqual([t["name"] for t in model.calls[0]["tools"]], ["echo"])

        reg2 = create_registry().register(name="echo", handler=lambda *_: "ok")
        run2 = await run_agent(
            model=scripted([call_spec("echo", {}, "c1")]),
            registry=reg2,
            tool_names=["echo"],
            max_iterations=3,
        )
        self.assertEqual(run2["exitReason"], "max_iterations")
        self.assertEqual(run2["iterations"], 3)

    # 4. Structured Output
    async def test_structured_output(self):
        schema = {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["MATCHED", "ADVISORY"]},
                "score": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["status", "score"],
            "additionalProperties": False,
        }

        self.assertEqual(validate(schema, {"status": "MATCHED", "score": 0.9}), [])
        self.assertEqual(
            len(validate(schema, {"status": "NOPE", "score": 2, "extra": 1})), 3
        )
        self.assertEqual(
            validate(schema, {"status": "MATCHED"}), ["$.score: is required"]
        )

        model = scripted(
            [
                {"content": "not json"},
                {"content": '{"status":"MATCHED","score":7}'},
                {"content": '```json\n{"status":"ADVISORY","score":0.4}\n```'},
            ]
        )
        res = await generate_structured(model=model, prompt="grade", schema=schema)
        self.assertTrue(res["ok"])
        self.assertEqual(res["attempts"], 3)
        self.assertEqual(res["value"], {"status": "ADVISORY", "score": 0.4})

    # 5. Delegation
    async def test_delegation(self):
        reg = create_registry().register(name="read_evidence", handler=lambda *_: {"fields": 3})
        register_delegate_tool(reg, {"model": None})

        model = scripted(
            [
                lambda req: {
                    "content": (
                        "summary A" if "Goal: A" in req["system"] else "summary B"
                    )
                }
            ]
        )

        out = await delegate_task(
            tasks=[{"goal": "A", "context": "only A context"}, {"goal": "B"}],
            model=model,
            registry=reg,
            parent={"depth": 0, "toolNames": ["read_evidence", "delegate_task"]},
        )

        self.assertEqual(
            [[r["status"], r["summary"]] for r in out["results"]],
            [["completed", "summary A"], ["completed", "summary B"]],
        )

        deep = await delegate_task(
            tasks=[{"goal": "x"}], model=model, registry=reg, parent={"depth": 1}
        )
        self.assertIn("depth limit", deep.get("error", ""))

    # 6. Skill
    def test_skill(self):
        with open(SKILL_PATH, "r", encoding="utf-8") as f:
            skill_text = f.read()
        skill = parse_skill(skill_text)
        self.assertEqual(skill["name"], "credit-underwriter")
        self.assertEqual(skill["version"], "1.0.0")

        with open(EVIDENCE_RULES_PATH, "r", encoding="utf-8") as f:
            ev_rules = f.read()
        prompt = skill_prompt(skill, {"evidence-rules": ev_rules})
        self.assertIn("## You may not", prompt)
        self.assertIn("Reference: evidence-rules", prompt)

    # 7. Grounded Evidence Extraction Adapter
    async def test_extraction_adapter(self):
        invoice = {
            "id": "doc-inv",
            "type": "DEALER_INVOICE",
            "filename": "invoice_ev.pdf",
            "pages": [
                "TAX INVOICE  INV-24-08817\nEx-showroom price  Rs 1,09,500.00\nRegistration & RTO  Rs 14,500.00\nOn-road price  Rs 1,24,000.00\nChassis No. MD9EVS24A7K004471",
            ],
        }

        def invoice_model(on_road_conf):
            return scripted(
                [
                    call_spec("read_document", {"page": 1}, "r1"),
                    call_spec(
                        "record_evidence",
                        {
                            "path": "invoice.on_road_price",
                            "value": "1,24,000",
                            "confidence": on_road_conf,
                            "page": 1,
                            "snippet": "On-road price  Rs 1,24,000.00",
                        },
                        "e1",
                    ),
                    call_spec(
                        "record_evidence",
                        {
                            "path": "invoice.ex_showroom",
                            "value": 110000,
                            "confidence": 0.99,
                            "page": 1,
                            "snippet": "Ex-showroom price  Rs 1,09,500.00",
                        },
                        "e2",
                    ),
                    call_spec(
                        "record_evidence",
                        {
                            "path": "invoice.chassis_number",
                            "value": "MD9EVS24A7K004471",
                            "confidence": 0.97,
                            "page": 1,
                            "snippet": "Chassis No. MD9EVS24A7K009999",
                        },
                        "e3",
                    ),
                    call_spec(
                        "record_evidence",
                        {
                            "path": "applicant.name",
                            "value": "ARJUN",
                            "confidence": 0.99,
                            "page": 1,
                            "snippet": "TAX INVOICE",
                        },
                        "e4",
                    ),
                    call_spec(
                        "record_evidence",
                        {
                            "path": "invoice.on_road_price",
                            "value": 124000,
                            "confidence": 1.4,
                            "page": 1,
                            "snippet": "On-road price  Rs 1,24,000.00",
                        },
                        "e5",
                    ),
                    call_spec(
                        "record_evidence",
                        {
                            "path": "invoice.chassis_number",
                            "value": "MD9EVS24A7K004471",
                            "confidence": 0.97,
                            "page": 1,
                            "snippet": "chassis no.   MD9EVS24A7K004471",
                        },
                        "e6",
                    ),
                    {"content": "Recorded on-road price and chassis number."},
                ]
            )

        events = []
        model = invoice_model(0.95)
        adapter = create_agent_extraction_adapter(
            model=model, on_event=lambda e: events.append(e)
        )
        fields = await adapter.extract(invoice)

        self.assertEqual(
            sorted(fields.keys()),
            ["invoice.chassis_number", "invoice.on_road_price"],
        )
        self.assertEqual(fields["invoice.on_road_price"]["value"], 124000)

        bundle_res = await extract_bundle(
            documents=[invoice],
            application={},
            adapter=create_agent_extraction_adapter(model=invoice_model(0.95)),
            seed="T",
        )
        self.assertEqual(bundle_res["stats"]["adapter"], "agent")

    # 8. Narration Stylist
    async def test_narration_stylist(self):
        memo = {
            "sections": [
                {
                    "id": "income",
                    "kind": "prose",
                    "body": "Recognised income is ₹18,400.00 per month over 6 months.",
                }
            ]
        }

        drifted = await narrate(
            memo,
            stylist=create_narration_stylist(
                model=scripted([{"content": "Income is roughly ₹18,500 a month."}])
            ),
        )
        self.assertEqual(drifted["sections"][0]["body"], memo["sections"][0]["body"])

    # 9. Invariant: Agent package doesn't import financial engines
    def test_structural_invariants(self):
        agent_dir = ROOT / "recaller" / "agent"
        for py_file in agent_dir.rglob("*.py"):
            with open(py_file, "r", encoding="utf-8") as f:
                content = f.read()
            imports = re.findall(r"^(?:from|import)\s+.*$", content, re.MULTILINE)
            offenders = [
                imp
                for imp in imports
                if any(k in imp for k in ["credit_engine", "policy_engine", "whatif"])
            ]
            self.assertEqual(
                offenders,
                [],
                f"{py_file.name} illegally imports engines: {offenders}",
            )


if __name__ == "__main__":
    unittest.main()
