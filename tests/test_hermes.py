"""RECALLER agent layer (recaller/ai/hermes) — every model here is scripted.

These pin the boundaries: which tools an agent can reach, what a child agent can
see, what the evidence agent may record, and which numbers an explanation may say.
"""

import asyncio
import json
import re
import unittest
from pathlib import Path

from pydantic import BaseModel

from recaller.ai.hermes import (
    AgentExtractionAdapter,
    AnthropicProvider,
    ScriptedProvider,
    ToolRegistry,
    delegate_task,
    generate_structured,
    is_forbidden_tool_name,
    list_skills,
    load_skill,
    resolve_toolset,
    run_agent,
    skill_prompt,
    unsupported_numbers,
)
from recaller.documents.patterns import extract_patterns, placeholders
from recaller.documents.router import RoutedExtractionAdapter
from recaller.extraction.adapters import coerce_list

ROOT = Path(__file__).resolve().parent.parent


def run(coro):
    return asyncio.run(coro)


def call(name, args, cid):
    return {"tool_calls": [{"id": cid, "name": name, "arguments": args}]}


class Verdict(BaseModel):
    status: str
    score: float


class TestRegistry(unittest.TestCase):
    def test_no_agent_can_be_handed_a_decision(self):
        for name in ["approve_loan", "reject_application", "calculate_emi", "compute_foir", "set_policy", "override_decision", "refer_case"]:
            self.assertTrue(is_forbidden_tool_name(name), name)
            with self.assertRaises(ValueError):
                ToolRegistry().register(name, lambda a: None)
        for name in ["read_decision", "record_evidence", "read_reference", "flag_issue", "delegate_task"]:
            self.assertFalse(is_forbidden_tool_name(name), name)

    def test_handler_errors_are_bounded(self):
        reg = ToolRegistry().register("boom", lambda a: (_ for _ in ()).throw(RuntimeError("x" * 5000)))
        out = json.loads(run(reg.dispatch("boom", {})))
        self.assertLess(len(out["error"]), 2100)
        self.assertTrue(out["error"].endswith("[truncated]"))

    def test_toolsets(self):
        self.assertEqual(resolve_toolset("evidence"), ["read_document", "record_evidence", "flag_issue"])
        self.assertIn("delegate_task", resolve_toolset("supervisor"))
        self.assertIn("get_credit_result", resolve_toolset("supervisor"))


class TestLoop(unittest.TestCase):
    def test_only_allowed_tools_run(self):
        seen = []
        reg = ToolRegistry().register("echo", lambda a: seen.append(a) or {"echoed": a.get("text")}).register(
            "secret", lambda a: seen.append("secret") or "leaked"
        )
        provider = ScriptedProvider([call("echo", '{"text":"hi"}', "c1"), call("secret", {}, "c2"), {"content": "done"}])
        result = run(run_agent(provider=provider, registry=reg, tool_names=["echo"], messages=[{"role": "user", "content": "go"}]))
        self.assertEqual(result.exit_reason, "completed")
        self.assertEqual(seen, [{"text": "hi"}])
        self.assertIn("not available", result.tool_calls[1]["result"])
        self.assertEqual([t["name"] for t in provider.calls[0]["tools"]], ["echo"])

    def test_budget_and_refusal(self):
        reg = ToolRegistry().register("echo", lambda a: "ok")
        r = run(run_agent(provider=ScriptedProvider([call("echo", {}, "c")]), registry=reg, tool_names=["echo"], max_iterations=3))
        self.assertEqual((r.exit_reason, r.iterations), ("max_iterations", 3))
        r = run(run_agent(provider=ScriptedProvider([{"content": "", "stop_reason": "refusal"}]), registry=reg, tool_names=["echo"]))
        self.assertEqual(r.exit_reason, "refusal")


class TestStructuredAndDelegation(unittest.TestCase):
    def test_structured_retries_until_valid(self):
        provider = ScriptedProvider([{"content": "not json"}, {"content": '{"status":"OK"}'}, {"content": '```json\n{"status":"OK","score":0.9}\n```'}])
        value, errors, attempts = run(generate_structured(provider=provider, response_model=Verdict, system="", prompt="grade"))
        self.assertEqual((value.score, attempts), (0.9, 3))
        self.assertIn("score", provider.calls[2]["messages"][-1]["content"])

    def test_children_are_isolated_leaves(self):
        reg = ToolRegistry().register("read_evidence", lambda a: {"n": 3}).register("delegate_task", lambda a: "never")
        provider = ScriptedProvider([lambda req: {"content": "summary A" if "Goal: A" in req["system"] else "summary B"}])
        out = run(
            delegate_task(
                tasks=[{"goal": "A", "context": "only A context"}, {"goal": "B"}],
                provider=provider,
                registry=reg,
                parent={"depth": 0, "tool_names": ["read_evidence", "delegate_task"]},
            )
        )
        self.assertEqual([r["summary"] for r in out["results"]], ["summary A", "summary B"])
        for c in provider.calls:
            self.assertEqual(len(c["messages"]), 1)
            self.assertNotIn("delegate_task", [t["name"] for t in c["tools"]])
        b = next(c for c in provider.calls if "Goal: B" in c["system"])
        self.assertNotIn("only A context", b["system"])
        deep = run(delegate_task(tasks=[{"goal": "x"}], provider=provider, registry=reg, parent={"depth": 1}))
        self.assertIn("depth limit", deep["error"])

    def test_output_schema_gets_one_correction(self):
        provider = ScriptedProvider([{"content": "it matches"}, {"content": '{"status":"MATCHED","score":0.97}'}])
        out = run(delegate_task(tasks=[{"goal": "compare"}], provider=provider, registry=ToolRegistry(), output_model=Verdict))
        self.assertTrue(out["results"][0]["schema_valid"])
        self.assertEqual(out["results"][0]["output"]["score"], 0.97)


class TestSkills(unittest.TestCase):
    def test_shipped_skills(self):
        skills = {s["name"]: s for s in list_skills()}
        self.assertEqual(set(skills), {"credit-underwriter", "instructor"})
        self.assertEqual(skills["instructor"]["license"], "MIT")
        self.assertEqual(skills["credit-underwriter"]["references"], ["evidence-rules", "reason-codes", "reconciliation-rules"])
        prompt = skill_prompt(load_skill("credit-underwriter"))
        self.assertIn("## You must not", prompt)
        self.assertIn("Reference: reason-codes", prompt)


INVOICE = {
    "id": "doc-inv",
    "type": "DEALER_INVOICE",
    "filename": "invoice.pdf",
    "_pages_text": [
        "TAX INVOICE  INV-24-08817\nEx-showroom price  Rs 1,09,500.00\nRegistration & RTO  Rs 14,500.00\n"
        "On-road price  Rs 1,24,000.00\nChassis No. MD9EVS24A7K004471\nVehicle Category: EV_2W"
    ],
}


class TestEvidenceAgent(unittest.TestCase):
    def script(self, conf):
        return ScriptedProvider(
            [
                call("read_document", {"page": 1}, "r1"),
                call("record_evidence", {"path": "invoice.on_road_price", "value": "1,24,000", "confidence": conf, "page": 1, "snippet": "On-road price  Rs 1,24,000.00"}, "e1"),
                call("record_evidence", {"path": "invoice.ex_showroom", "value": 110000, "confidence": 0.99, "page": 1, "snippet": "Ex-showroom price  Rs 1,09,500.00"}, "e2"),
                call("record_evidence", {"path": "invoice.chassis_number", "value": "MD9EVS24A7K004471", "confidence": 0.97, "page": 1, "snippet": "Chassis No. MD9EVS24A7K009999"}, "e3"),
                call("record_evidence", {"path": "applicant.name", "value": "ARJUN", "confidence": 0.99, "page": 1, "snippet": "TAX INVOICE"}, "e4"),
                call("record_evidence", {"path": "invoice.chassis_number", "value": "MD9EVS24A7K004471", "confidence": 0.97, "page": 1, "snippet": "chassis no.   MD9EVS24A7K004471"}, "e5"),
                {"content": "Recorded on-road price and chassis number."},
            ]
        )

    def test_only_grounded_fields_are_recorded(self):
        provider = self.script(0.95)
        adapter = AgentExtractionAdapter(provider)
        fields = run(adapter.extract(INVOICE, "seed"))
        self.assertEqual(sorted(fields), ["invoice.chassis_number", "invoice.on_road_price"])
        self.assertEqual(fields["invoice.on_road_price"]["value"], 124000)
        self.assertEqual(fields["invoice.on_road_price"]["citation"]["method"], "agent")
        results = [json.loads(m["content"]) for m in provider.calls[-1]["messages"] if m["role"] == "tool"]
        self.assertIn("does not appear in the snippet", results[2]["error"])
        self.assertIn("does not appear on the cited page", results[3]["error"])
        self.assertIn("not a field a DEALER_INVOICE", results[4]["error"])
        self.assertTrue(results[5]["ok"])
        enum = provider.calls[0]["tools"][1]["input_schema"]["properties"]["path"]["enum"]
        self.assertNotIn("applicant.age", enum)

    def test_router_fills_agent_gaps_with_patterns(self):
        router = RoutedExtractionAdapter(agent=AgentExtractionAdapter(self.script(0.95)))
        fields = run(router.extract(INVOICE, "seed"))
        self.assertEqual(router.routes["doc-inv"]["route"], "agent+pattern")
        self.assertEqual(fields["invoice.ex_showroom"]["citation"]["method"], "pattern")  # the agent's inferred value was refused
        self.assertEqual(fields["invoice.ex_showroom"]["value"], 109500)


class TestPatterns(unittest.TestCase):
    def test_labelled_lines_and_placeholders(self):
        doc = {
            "id": "b1",
            "type": "BANK_STATEMENT",
            "filename": "stmt.pdf",
            "_pages_text": ["Account Holder: Asha Verma\nAccount No: XXXXXXXX7781\nMonthly Credits: 38,200 | 39,100 | 37,600\nRecurring Debit: Phone EMI, 1,200"],
        }
        found = extract_patterns(doc)
        self.assertEqual(found["bank.monthly_credits"]["value"], [38200, 39100, 37600])
        self.assertEqual(found["bank.recurring_debits"]["value"][0]["amount"], 1200)
        self.assertEqual(found["bank.account_holder_name"]["value"], "Asha Verma")
        self.assertEqual(placeholders(doc, found), {})
        gaps = placeholders(doc, {})
        self.assertEqual(gaps["bank.monthly_credits"]["confidence"], 0.0)
        self.assertEqual(gaps["bank.recurring_debits"]["value"], [])

    def test_officer_lists(self):
        self.assertEqual(coerce_list("33,200, 35100"), [33200, 35100])
        self.assertEqual(coerce_list("Bajaj EMI 2,400; Phone 1200")[0], {"label": "Bajaj EMI", "amount": 2400.0, "kind": "LOAN_EMI", "source": "Officer entry"})
        self.assertEqual(coerce_list("none"), [])


class TestGuardsAndProvider(unittest.TestCase):
    def test_numeric_guard(self):
        allowed = [0.3814, 3417.76, 18400.0]
        self.assertEqual(unsupported_numbers("FOIR is 38.14% and EMI ₹3,417.76 on 18,400 income over 3 months", allowed), [])
        self.assertEqual(unsupported_numbers("EMI is roughly ₹3,500", allowed), [3500.0])

    def test_anthropic_message_conversion(self):
        msgs = [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "t1", "name": "a", "arguments": {}}, {"id": "t2", "name": "b", "arguments": {}}]},
            {"role": "tool", "tool_call_id": "t1", "name": "a", "content": "1"},
            {"role": "tool", "tool_call_id": "t2", "name": "b", "content": "{}", "is_error": True},
        ]
        api = AnthropicProvider.to_api_messages(msgs)
        self.assertEqual([m["role"] for m in api], ["user", "assistant", "user"])
        self.assertEqual([b["tool_use_id"] for b in api[2]["content"]], ["t1", "t2"])  # parallel results in ONE message
        self.assertTrue(api[2]["content"][1]["is_error"])
        echoed = AnthropicProvider.to_api_messages([{"role": "assistant", "content": "x", "provider_content": [{"type": "thinking", "thinking": "", "signature": "s"}]}])
        self.assertEqual(echoed[0]["content"][0]["type"], "thinking")

    def test_agent_layer_cannot_import_the_engines(self):
        offenders = []
        for f in (ROOT / "recaller" / "ai").rglob("*.py"):
            imports = "\n".join(re.findall(r"^\s*(?:from|import) .*$", f.read_text(encoding="utf-8"), re.M))
            if re.search(r"credit_engine|policy_engine|whatif", imports):
                offenders.append(str(f))
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
