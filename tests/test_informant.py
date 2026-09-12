"""RECALLER — informal-lender reference.

Covers the whole path an attestation takes: typed extraction, computed
confidence, provenance, the confidence gate, officer resolution and resume,
the deterministic obligation effect, and the boundary that stops any of it
from becoming a number an agent chose.
"""

import asyncio
import copy
import json
import unittest
from pathlib import Path

from recaller.core.constants import DOC_TYPES, PROVENANCE
from recaller.credit_engine.engine import (
    compute_credit_metrics,
    reconcile_informant_obligation,
)
from recaller.extraction.adapters import apply_confidence_gate, extract_bundle, materialise
from recaller.extraction.informant import (
    attestation_quality,
    completeness,
    ledger_coherence,
)
from recaller.extraction.schema import SPEC_BY_PATH
from recaller.orchestrator.pipeline import replay, resume_underwriting, run_underwriting
from recaller.synthetic.data import SYNTHETIC_APPLICATIONS

ROOT = Path(__file__).resolve().parent.parent
POLICY = json.loads((ROOT / "policy" / "policy.v1.json").read_text(encoding="utf-8"))

# A complete, verified, arm's-length, internally consistent reference.
COHERENT = {
    "name": "Suresh Kumar Gupta",
    "relationship": "SHOPKEEPER_CREDIT",
    "business_name": "Gupta General Store",
    "contact": "98XXXXXX07",
    "contact_verified": True,
    "borrower_known_as": "Rahul Sharma",
    "months_known": 34,
    "principal_lent": 45000,
    "current_outstanding": 12000,
    "monthly_repayment": 3000,
    "missed_payments_12m": 1,
    "longest_delay_days": 6,
    "would_lend_again": True,
    "attested_at": "2026-08-28",
}


def app_by_id(app_id):
    for a in SYNTHETIC_APPLICATIONS:
        if a["id"] == app_id:
            return a
    raise AssertionError(f"no fixture {app_id}")


def header_of(app):
    return {k: v for k, v in app.items() if k not in ("documents", "scenario")}


class TestTypedExtraction(unittest.TestCase):
    def test_every_informant_field_is_typed(self):
        paths = [p for p in SPEC_BY_PATH if p.startswith("informant.")]
        self.assertGreaterEqual(len(paths), 12)
        allowed = {"text", "money", "number", "date", "flag", "id", "list"}
        for p in paths:
            spec = SPEC_BY_PATH[p]
            self.assertIn(spec["type"], allowed, p)
            self.assertEqual(spec["doc"], DOC_TYPES.INFORMANT_REFERENCE, p)
            self.assertTrue(spec.get("attested"), f"{p} must be marked attested")

    def test_money_and_number_fields_are_not_text(self):
        self.assertEqual(SPEC_BY_PATH["informant.monthly_repayment"]["type"], "money")
        self.assertEqual(SPEC_BY_PATH["informant.principal_lent"]["type"], "money")
        self.assertEqual(SPEC_BY_PATH["informant.months_known"]["type"], "number")
        self.assertEqual(SPEC_BY_PATH["informant.contact_verified"]["type"], "flag")
        self.assertEqual(SPEC_BY_PATH["informant.attested_at"]["type"], "date")


class TestConfidenceIsComputed(unittest.TestCase):
    """Confidence must be derived from the evidence, not sampled or assumed."""

    def test_identical_input_gives_identical_confidence(self):
        a = attestation_quality(COHERENT, POLICY)
        b = attestation_quality(copy.deepcopy(COHERENT), POLICY)
        self.assertEqual(a["identity_confidence"], b["identity_confidence"])
        self.assertEqual(a["ledger_confidence"], b["ledger_confidence"])

    def test_confidence_is_not_a_constant(self):
        """Different evidence quality must produce different confidence."""
        scores = set()
        for mutation in (
            {},
            {"contact_verified": False},
            {"months_known": 2},
            {"relationship": "FAMILY"},
            {"current_outstanding": 90000},
            {"missed_payments_12m": None, "attested_at": None, "contact": None},
        ):
            ref = {**COHERENT, **mutation}
            scores.add(attestation_quality(ref, POLICY)["ledger_confidence"])
        self.assertGreaterEqual(
            len(scores), 6, f"confidence barely moves across evidence quality: {scores}"
        )

    def test_unverified_contact_lowers_the_ceiling(self):
        verified = attestation_quality(COHERENT, POLICY)
        unverified = attestation_quality({**COHERENT, "contact_verified": False}, POLICY)
        self.assertLess(unverified["ceiling"], verified["ceiling"])
        self.assertLess(
            unverified["identity_confidence"], verified["identity_confidence"]
        )

    def test_non_arms_length_relationship_is_capped_hardest(self):
        family = attestation_quality({**COHERENT, "relationship": "FAMILY"}, POLICY)
        self.assertFalse(family["arms_length"])
        self.assertLessEqual(
            family["ceiling"],
            POLICY["confidence"]["informant"]["non_arms_length_ceiling"],
        )

    def test_incomplete_reference_scores_lower(self):
        partial = {k: v for k, v in COHERENT.items() if k in ("name", "relationship")}
        self.assertLess(completeness(partial), completeness(COHERENT))
        self.assertLess(
            attestation_quality(partial, POLICY)["identity_confidence"],
            attestation_quality(COHERENT, POLICY)["identity_confidence"],
        )

    def test_confidence_never_exceeds_the_policy_ceiling(self):
        q = attestation_quality(COHERENT, POLICY)
        ceiling = POLICY["confidence"]["informant"]["source_confidence_ceiling"]
        self.assertLessEqual(q["identity_confidence"], ceiling)
        self.assertLessEqual(q["ledger_confidence"], ceiling)


class TestLedgerCoherence(unittest.TestCase):
    def test_coherent_ledger_has_no_problems(self):
        c = ledger_coherence(COHERENT, POLICY)
        self.assertEqual(c["problems"], [])
        self.assertEqual(c["score"], 1.0)
        self.assertEqual(c["implied_months_repaid"], 11.0)

    def test_outstanding_above_principal_is_caught(self):
        c = ledger_coherence({**COHERENT, "current_outstanding": 90000}, POLICY)
        self.assertIn(
            "OUTSTANDING_EXCEEDS_PRINCIPAL", [p["code"] for p in c["problems"]]
        )
        self.assertLess(c["score"], 1.0)

    def test_repayment_that_outruns_the_relationship_is_caught(self):
        # 60,000 repaid at 4,000/month is 15 months, inside a 9-month relationship.
        ref = {
            **COHERENT,
            "principal_lent": 60000,
            "current_outstanding": 0,
            "monthly_repayment": 4000,
            "months_known": 9,
        }
        c = ledger_coherence(ref, POLICY)
        codes = [p["code"] for p in c["problems"]]
        self.assertIn("REPAYMENT_EXCEEDS_RELATIONSHIP", codes)

    def test_penalty_scales_with_the_size_of_the_contradiction(self):
        mild = ledger_coherence(
            {**COHERENT, "principal_lent": 60000, "current_outstanding": 0,
             "monthly_repayment": 4000, "months_known": 12}, POLICY
        )
        severe = ledger_coherence(
            {**COHERENT, "principal_lent": 600000, "current_outstanding": 0,
             "monthly_repayment": 4000, "months_known": 12}, POLICY
        )
        self.assertGreater(mild["score"], severe["score"])

    def test_missing_numbers_are_unknown_not_wrong(self):
        c = ledger_coherence({"name": "X"}, POLICY)
        self.assertFalse(c["checkable"])
        self.assertEqual(c["problems"], [])


class TestProvenance(unittest.IsolatedAsyncioTestCase):
    async def test_every_informant_field_carries_source_and_provenance(self):
        app = app_by_id("RCL-2026-0418")
        out = await extract_bundle(
            documents=app["documents"],
            application=header_of(app),
            policy=POLICY,
        )
        informant = {k: v for k, v in out["fields"].items() if k.startswith("informant.")}
        self.assertTrue(informant)
        for path, f in informant.items():
            self.assertEqual(f["provenance"], PROVENANCE.INFORMANT, path)
            cite = f["citation"]
            self.assertEqual(cite["document"], "InformantReference.pdf", path)
            self.assertTrue(cite["document_id"], path)
            self.assertIn("page", cite)
            self.assertTrue(f.get("attested"), path)
            # The score that put it in or out of the queue travels with it.
            self.assertIn("attestation", f)
            self.assertIn("coherence", f["attestation"])


class TestConfidenceGate(unittest.TestCase):
    def _fields(self, informant, policy=POLICY):
        from recaller.extraction.adapters import fixture_adapter

        doc = {
            "id": "D1",
            "type": DOC_TYPES.INFORMANT_REFERENCE,
            "filename": "InformantReference.pdf",
            "payload": {"informant": informant},
            "pageMap": {},
        }
        return fixture_adapter.extract(doc, "seed", policy)

    def test_coherent_reference_clears_the_attested_floor(self):
        gate = apply_confidence_gate(self._fields(COHERENT), POLICY)
        held = [h["path"] for h in gate["held"] if h["path"].startswith("informant.")]
        self.assertEqual(held, [], f"a sound reference should not need an officer: {held}")

    def test_incoherent_reference_is_held_for_an_officer(self):
        bad = {
            **COHERENT,
            "principal_lent": 60000,
            "current_outstanding": 0,
            "monthly_repayment": 4000,
            "months_known": 9,
            "contact_verified": False,
        }
        gate = apply_confidence_gate(self._fields(bad), POLICY)
        held = {h["path"]: h for h in gate["held"]}
        self.assertIn("informant.monthly_repayment", held)
        self.assertIn("informant.current_outstanding", held)
        self.assertFalse(gate["passed"])

    def test_held_field_explains_itself_in_officer_terms(self):
        bad = {**COHERENT, "current_outstanding": 900000}
        gate = apply_confidence_gate(self._fields(bad), POLICY)
        reasons = [h["reason"] for h in gate["held"]]
        self.assertTrue(
            any("does not add up" in r for r in reasons),
            f"officer is not told why: {reasons}",
        )

    def test_attested_evidence_uses_its_own_floors(self):
        gate = apply_confidence_gate(self._fields(COHERENT), POLICY)
        t = gate["thresholds"]
        self.assertIn("attested_field_threshold", t)
        self.assertLess(t["attested_critical_field_threshold"], t["critical_field_threshold"])

    def test_thresholds_come_from_policy_not_from_code(self):
        """Tighten the policy and the same evidence must now be held."""
        strict = copy.deepcopy(POLICY)
        strict["confidence"]["attested_critical_field_threshold"] = 0.99
        gate = apply_confidence_gate(self._fields(COHERENT), strict)
        self.assertFalse(gate["passed"])
        self.assertTrue(
            any(h["path"].startswith("informant.") for h in gate["held"])
        )


class TestDeterministicObligation(unittest.TestCase):
    """The informant states a number; only the engine decides what it means."""

    def test_undisclosed_repayment_is_added(self):
        out = reconcile_informant_obligation(COHERENT, [], POLICY)
        self.assertTrue(out["applicable"])
        self.assertFalse(out["corroborated"])
        self.assertEqual(out["added"], 3000.0)

    def test_repayment_already_in_the_statement_is_not_double_counted(self):
        debits = [{"label": "Cash withdrawal standing instruction", "amount": 3000, "kind": "LOAN_EMI"}]
        out = reconcile_informant_obligation(COHERENT, debits, POLICY)
        self.assertTrue(out["corroborated"])
        self.assertEqual(out["added"], 0.0)
        self.assertEqual(out["matched_debit"]["amount"], 3000.0)

    def test_match_uses_the_policy_tolerance(self):
        # 2,700 against 3,000 is a 10% gap — inside the 15% policy tolerance.
        near = reconcile_informant_obligation(
            COHERENT, [{"label": "x", "amount": 2700}], POLICY
        )
        self.assertTrue(near["corroborated"])
        # 1,000 is not the same loan.
        far = reconcile_informant_obligation(
            COHERENT, [{"label": "x", "amount": 1000}], POLICY
        )
        self.assertFalse(far["corroborated"])

    def test_settled_loan_adds_no_obligation(self):
        settled = {**COHERENT, "current_outstanding": 0, "monthly_repayment": 0}
        out = reconcile_informant_obligation(settled, [], POLICY)
        self.assertFalse(out["applicable"])
        self.assertEqual(out["added"], 0.0)

    def test_no_reference_changes_nothing(self):
        out = reconcile_informant_obligation(None, [], POLICY)
        self.assertFalse(out["applicable"])
        self.assertEqual(out["added"], 0.0)

    def test_obligation_reaches_foir_through_the_engine(self):
        evidence = {
            "bank": {"monthly_credits": [30000] * 6, "monthly_cash_deposits": [0] * 6,
                     "recurring_debits": [], "average_monthly_balance": 9000, "bounce_count": 0},
            "invoice": {"on_road_price": 100000},
            "applicant": {"age": 30},
        }
        loan = {"amount": 80000, "tenureMonths": 36, "segment": "EV_2W"}
        without = compute_credit_metrics(evidence=evidence, loan_request=loan, policy=POLICY)
        with_ref = compute_credit_metrics(
            evidence={**evidence, "informant": COHERENT}, loan_request=loan, policy=POLICY
        )
        self.assertEqual(without["metrics"]["obligations"], 0.0)
        self.assertEqual(with_ref["metrics"]["obligations"], 3000.0)
        self.assertGreater(with_ref["metrics"]["foir"], without["metrics"]["foir"])
        # EMI depends on the loan, never on the reference.
        self.assertEqual(with_ref["metrics"]["emi"], without["metrics"]["emi"])

    def test_reference_cannot_raise_recognised_income(self):
        evidence = {
            "bank": {"monthly_credits": [30000] * 6, "monthly_cash_deposits": [0] * 6,
                     "recurring_debits": []},
            "invoice": {"on_road_price": 100000},
        }
        loan = {"amount": 80000, "tenureMonths": 36, "segment": "EV_2W"}
        base = compute_credit_metrics(evidence=evidence, loan_request=loan, policy=POLICY)
        # Even a reference claiming an enormous, spotless loan cannot add income.
        generous = {**COHERENT, "principal_lent": 5000000, "missed_payments_12m": 0}
        loaded = compute_credit_metrics(
            evidence={**evidence, "informant": generous}, loan_request=loan, policy=POLICY
        )
        self.assertEqual(
            loaded["metrics"]["verified_monthly_income"],
            base["metrics"]["verified_monthly_income"],
        )

    def test_obligation_enters_the_fingerprint(self):
        evidence = {
            "bank": {"monthly_credits": [30000] * 6, "monthly_cash_deposits": [0] * 6,
                     "recurring_debits": []},
            "invoice": {"on_road_price": 100000},
        }
        loan = {"amount": 80000, "tenureMonths": 36, "segment": "EV_2W"}
        a = compute_credit_metrics(evidence=evidence, loan_request=loan, policy=POLICY)
        b = compute_credit_metrics(
            evidence={**evidence, "informant": COHERENT}, loan_request=loan, policy=POLICY
        )
        self.assertNotEqual(a["input_hash"], b["input_hash"])


class TestAgentCannotMutateNumbers(unittest.TestCase):
    """The strongest claim the architecture makes, tested directly."""

    def test_engine_output_is_recomputed_not_accepted(self):
        evidence = {
            "bank": {"monthly_credits": [30000] * 6, "monthly_cash_deposits": [0] * 6,
                     "recurring_debits": []},
            "invoice": {"on_road_price": 100000},
            "informant": COHERENT,
        }
        loan = {"amount": 80000, "tenureMonths": 36, "segment": "EV_2W"}
        truth = compute_credit_metrics(evidence=evidence, loan_request=loan, policy=POLICY)

        # An agent asserts different numbers on the evidence it was shown.
        tampered = copy.deepcopy(evidence)
        tampered["informant"] = {
            **COHERENT,
            "monthly_repayment": 0,          # "there is no obligation here"
            "_asserted_foir": 0.10,
            "_asserted_emi": 1,
        }
        # Only the declared repayment is evidence; the assertions are ignored,
        # and the number the engine produces still comes from the engine.
        recomputed = compute_credit_metrics(
            evidence=tampered, loan_request=loan, policy=POLICY
        )
        self.assertEqual(recomputed["metrics"]["emi"], truth["metrics"]["emi"])
        self.assertNotEqual(recomputed["metrics"]["emi"], 1)
        self.assertNotEqual(recomputed["metrics"]["foir"], 0.10)

    def test_no_agent_tool_may_be_named_for_a_credit_computation(self):
        from recaller.ai.hermes.registry import is_forbidden_tool_name

        for name in (
            "compute_informant_foir",
            "calculate_informal_obligation",
            "approve_with_informant_reference",
            "override_informant_confidence",
        ):
            self.assertTrue(is_forbidden_tool_name(name), name)


class TestEndToEnd(unittest.IsolatedAsyncioTestCase):
    async def _run(self, app_id):
        app = app_by_id(app_id)
        h = header_of(app)
        return app, h, await run_underwriting(
            application=h, documents=app["documents"], policy=POLICY, now=h["created_at"]
        )

    async def test_settled_reference_leaves_a_clean_file_clean(self):
        _, _, rec = await self._run("RCL-2026-0418")
        self.assertEqual(rec["decision"]["decision"], "APPROVE")
        self.assertEqual(rec["credit"]["metrics"]["informal_obligation_added"], 0.0)
        codes = [f["code"] for f in rec["reconciliation"]["findings"]]
        self.assertIn("RC-INF-02", codes)
        self.assertIn("RC-INF-05", codes)

    async def test_undisclosed_repayment_moves_the_obligation_total(self):
        _, _, rec = await self._run("RCL-2026-0441")
        m = rec["credit"]["metrics"]
        self.assertEqual(m["informal_obligation_added"], 2800.0)
        self.assertEqual(m["obligations"], 2800.0)
        finding = next(
            f for f in rec["reconciliation"]["findings"] if f["code"] == "RC-INF-01"
        )
        self.assertEqual(finding["severity"], "ADVISORY")

    async def test_incoherent_reference_suspends_for_an_officer_then_resumes(self):
        app, h, rec = await self._run("RCL-2026-0421")
        self.assertEqual(rec["status"], "WAITING_FOR_OFFICER")
        held = [q["path"] for q in rec["assist"]["queue"]]
        self.assertIn("informant.monthly_repayment", held)
        self.assertIsNone(rec["decision"], "no verdict may exist while a file is held")

        resolutions = [
            {"path": q["path"], "action": "CONFIRM", "by": "officer",
             "at": h["created_at"], "note": "checked against the signed reference"}
            for q in rec["assist"]["queue"]
        ]
        resumed = await resume_underwriting(
            record=rec, resolutions=resolutions, policy=POLICY, now=h["created_at"]
        )
        self.assertNotEqual(resumed["status"], "WAITING_FOR_OFFICER")
        self.assertIsNotNone(resumed["decision"])
        # Reconciliation and policy both re-ran on the corrected evidence.
        self.assertTrue(resumed["reconciliation"]["findings"])
        self.assertTrue(resumed["policyEvaluation"]["rules"])
        # Officer resolution is recorded as provenance, not silently absorbed.
        f = resumed["evidence"]["fields"]["informant.monthly_repayment"]
        self.assertEqual(f["provenance"], PROVENANCE.OFFICER)
        self.assertIn("superseded", f)

    async def test_officer_correction_reruns_the_engine_and_moves_the_fingerprint(self):
        """The reference says the loan is settled. The officer finds it is not.

        Confirming the extracted values and correcting them must not produce the
        same file: the correction has to travel back through the engine.
        """
        app, h, rec = await self._run("RCL-2026-0421")
        queue = rec["assist"]["queue"]
        self.assertIn("informant.current_outstanding", [q["path"] for q in queue])

        confirm = await resume_underwriting(
            record=rec,
            resolutions=[
                {"path": q["path"], "action": "CONFIRM", "by": "o", "at": h["created_at"]}
                for q in queue
            ],
            policy=POLICY, now=h["created_at"],
        )
        corrected = await resume_underwriting(
            record=rec,
            resolutions=[
                {
                    "path": q["path"],
                    "action": "EDIT" if q["path"] == "informant.current_outstanding" else "CONFIRM",
                    # Still owed, contrary to what the reference stated.
                    "value": 20000 if q["path"] == "informant.current_outstanding" else None,
                    "by": "o", "at": h["created_at"],
                }
                for q in queue
            ],
            policy=POLICY, now=h["created_at"],
        )

        # A live informal loan with no matching bank debit is an obligation.
        self.assertEqual(confirm["credit"]["metrics"]["informal_obligation_added"], 0.0)
        self.assertEqual(corrected["credit"]["metrics"]["informal_obligation_added"], 4000.0)
        self.assertGreater(
            corrected["credit"]["metrics"]["obligations"],
            confirm["credit"]["metrics"]["obligations"],
        )
        self.assertGreater(
            corrected["credit"]["metrics"]["foir"], confirm["credit"]["metrics"]["foir"]
        )
        self.assertNotEqual(
            confirm["credit"]["input_hash"], corrected["credit"]["input_hash"]
        )

    async def test_a_settled_loan_is_unaffected_by_its_repayment_figure(self):
        """Nothing is owed, so what the monthly figure says cannot matter.

        This is the companion to the correction test: it pins down that the
        engine reads the obligation from the state of the loan, not from
        whichever number happens to sit in the repayment field.
        """
        app, h, rec = await self._run("RCL-2026-0421")
        queue = rec["assist"]["queue"]
        runs = []
        for value in (4000, 9000):
            runs.append(
                await resume_underwriting(
                    record=rec,
                    resolutions=[
                        {
                            "path": q["path"],
                            "action": "EDIT" if q["path"] == "informant.monthly_repayment" else "CONFIRM",
                            "value": value if q["path"] == "informant.monthly_repayment" else None,
                            "by": "o", "at": h["created_at"],
                        }
                        for q in queue
                    ],
                    policy=POLICY, now=h["created_at"],
                )
            )
        self.assertEqual(runs[0]["credit"]["input_hash"], runs[1]["credit"]["input_hash"])
        self.assertEqual(runs[0]["credit"]["metrics"]["informal_obligation_added"], 0.0)

    async def test_replay_reproduces_the_decision_exactly(self):
        for app_id in ("RCL-2026-0418", "RCL-2026-0441"):
            _, _, rec = await self._run(app_id)
            rp = await replay(record=rec, policy=POLICY)
            self.assertTrue(rp["identical"], f"{app_id}: {json.dumps(rp['diff'])}")
            self.assertFalse(rp["used_llm"])

    async def test_memo_cites_only_engine_numbers(self):
        _, _, rec = await self._run("RCL-2026-0441")
        section = next(s for s in rec["memo"]["sections"] if s["id"] == "informant")
        added = rec["credit"]["metrics"]["informal_obligation_added"]
        self.assertIn("2,800", section["body"])
        self.assertEqual(added, 2800.0)
        self.assertIn("does not relax it", section["body"])

    async def test_audit_records_the_informant_stage(self):
        _, _, rec = await self._run("RCL-2026-0418")
        stages = [e["stage"] for e in rec["audit"]["events"]]
        self.assertIn("INFORMANT_ATTESTATION", stages)

    async def test_files_without_a_reference_are_untouched(self):
        _, _, rec = await self._run("RCL-2026-0426")
        codes = [f["code"] for f in rec["reconciliation"]["findings"]]
        self.assertFalse([c for c in codes if c.startswith("RC-INF")])
        rule = next(
            r for r in rec["policyEvaluation"]["rules"] if r["code"] == "P-INF-01"
        )
        self.assertEqual(rule["outcome"], "NOT_APPLICABLE")


if __name__ == "__main__":
    unittest.main()
