"""RECALLER — deterministic engine tests (Python port of scripts/test-engine.mjs)."""

import json
import math
from pathlib import Path
import unittest

from recaller.core.audit import append_event, create_ledger, verify_ledger
from recaller.core.hash import hash_value, rng, stable_stringify
from recaller.core.money import format_inr, round_half_up, sum_rupees, to_paise, to_rupees
from recaller.credit_engine.engine import (
    band_for,
    compute_evidence_strength,
    amortisation_schedule,
    calculate_emi,
    calculate_foir,
    calculate_ltv,
    calculate_obligations,
    calculate_verified_income,
    coefficient_of_variation,
    compute_credit_metrics,
)
from recaller.policy_engine.engine import evaluate_policy
from recaller.reconciliation.reconcile import address_similarity, name_similarity
from recaller.whatif.solver import solve_minimum_change

ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = ROOT / "policy" / "policy.v1.json"


class TestRecallerEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(POLICY_PATH, "r", encoding="utf-8") as f:
            cls.policy = json.load(f)

    # ==================================================================
    # Money primitives
    # ==================================================================

    def test_money_primitives(self):
        self.assertEqual(to_paise(1234.56), 123456)
        self.assertEqual(to_paise("₹1,23,456.78"), 12345678)
        self.assertEqual(to_paise(""), 0)
        self.assertEqual(to_paise(-10.005), -to_paise(10.005))
        self.assertEqual(round_half_up(2.345, 2), 2.35)
        self.assertEqual(round_half_up(1.005, 2), 1.01)
        self.assertEqual(sum_rupees([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]), 4.5)
        self.assertEqual(format_inr(12345678), "₹1,23,45,678")
        self.assertEqual(format_inr(999), "₹999")
        self.assertEqual(format_inr(None), "—")

    # ==================================================================
    # EMI & Amortisation
    # ==================================================================

    def test_emi(self):
        self.assertAlmostEqual(calculate_emi(100000, 12, 12), 8884.88, delta=0.01)
        self.assertAlmostEqual(calculate_emi(500000, 10, 60), 10623.52, delta=0.01)
        self.assertEqual(calculate_emi(95000, 16.5, 36), 3363.42)
        self.assertEqual(calculate_emi(120000, 0, 12), 10000)
        self.assertEqual(calculate_emi(0, 12, 12), 0)
        self.assertEqual(calculate_emi(100000, 12, 0), 0)

        # Monotonicity checks
        tenure_emis = [calculate_emi(200000, 15, t) for t in [12, 24, 36, 48, 60]]
        self.assertTrue(all(tenure_emis[i] < tenure_emis[i - 1] for i in range(1, len(tenure_emis))))

        principal_emis = [calculate_emi(p, 15, 24) for p in [50000, 100000, 150000]]
        self.assertTrue(all(principal_emis[i] > principal_emis[i - 1] for i in range(1, len(principal_emis))))

    def test_amortisation(self):
        s = amortisation_schedule(95000, 16.5, 36)
        self.assertEqual(len(s["rows"]), 36)
        self.assertEqual(s["rows"][-1]["closing"], 0)
        principal_paid = sum_rupees([r["principal"] for r in s["rows"]])
        self.assertEqual(principal_paid, 95000)
        interest_paid = sum_rupees([r["interest"] for r in s["rows"]])
        self.assertEqual(s["totalInterest"], interest_paid)
        self.assertEqual(s["totalPayable"], round_half_up(95000 + interest_paid, 2))
        self.assertTrue(s["rows"][0]["interest"] > s["rows"][35]["interest"])

    # ==================================================================
    # FOIR, LTV, Obligations
    # ==================================================================

    def test_foir_and_ltv(self):
        self.assertEqual(calculate_foir(50000, 10000, 5000), 0.3)
        self.assertIsNone(calculate_foir(0, 1000, 1000))
        self.assertEqual(calculate_foir(40000, 0, 10000), 0.25)
        self.assertEqual(calculate_Ltv_val := calculate_ltv(85000, 100000), 0.85)
        self.assertIsNone(calculate_ltv(85000, 0))

    def test_obligations(self):
        o = calculate_obligations(
            [
                {"label": "A", "amount": 2400},
                {"label": "B", "amount": 3800.5},
                {"label": "C", "amount": 1000, "isObligation": False},
            ]
        )
        self.assertEqual(o["total"], 6200.5)
        self.assertEqual(len(o["items"]), 2)
        self.assertEqual(calculate_obligations([])["total"], 0)

    # ==================================================================
    # Income recognition
    # ==================================================================

    def test_income_recognition(self):
        rules = self.policy["income_recognition"]
        r = calculate_verified_income(
            {
                "monthlyBankCredits": [30000] * 6,
                "monthlyCashDeposits": [6000] * 6,
                "monthlyPlatformNet": None,
            },
            rules,
        )
        self.assertEqual(r["components"]["cash_admitted"], 3000)
        self.assertEqual(r["bank_view"], 27000)
        self.assertIsNone(r["platform_view"])
        self.assertEqual(r["verified_monthly_income"], 27000)

        capped = calculate_verified_income(
            {
                "monthlyBankCredits": [30000] * 6,
                "monthlyCashDeposits": [28000] * 6,
            },
            rules,
        )
        self.assertAlmostEqual(capped["components"]["cash_admitted"], 857.14, delta=0.02)

        lower = calculate_verified_income(
            {
                "monthlyBankCredits": [40000] * 6,
                "monthlyCashDeposits": [0] * 6,
                "monthlyPlatformNet": [30000] * 6,
            },
            rules,
        )
        self.assertEqual(lower["verified_monthly_income"], 27000)
        self.assertEqual(lower["platform_view"], 27000)

        self.assertEqual(coefficient_of_variation([100, 100, 100, 100]), 0)
        self.assertTrue(coefficient_of_variation([100, 20, 180, 40]) > 0.5)
        self.assertEqual(coefficient_of_variation([100]), 0)

    # ==================================================================
    # Determinism
    # ==================================================================

    def test_determinism_and_hashing(self):
        self.assertEqual(stable_stringify({"b": 1, "a": 2}), stable_stringify({"a": 2, "b": 1}))
        self.assertEqual(hash_value({"x": [1, 2], "y": "z"}), hash_value({"y": "z", "x": [1, 2]}))
        self.assertNotEqual(hash_value({"a": 1}), hash_value({"a": 2}))
        self.assertEqual(len(hash_value({"a": 1})), 32)

        gen_a = rng("seed-one")
        gen_b = rng("seed-one")
        gen_c = rng("seed-two")
        seq_a = [gen_a(), gen_a(), gen_a()]
        seq_b = [gen_b(), gen_b(), gen_b()]
        seq_c = [gen_c(), gen_c(), gen_c()]

        self.assertEqual(seq_a, seq_b)
        self.assertNotEqual(seq_a, seq_c)
        self.assertTrue(all(0 <= v < 1 for v in seq_a))

    # ==================================================================
    # Full Credit Engine & Policy Precedence
    # ==================================================================

    def test_credit_engine_and_policy(self):
        evidence = {
            "applicant": {"age": 32, "declared_monthly_income": 32000},
            "bank": {
                "monthly_credits": [33200, 35100, 34400, 32800, 35600, 34900],
                "monthly_cash_deposits": [5800, 6200, 5400, 6600, 5900, 6100],
                "average_monthly_balance": 8500,
                "bounce_count": 0,
                "recurring_debits": [{"label": "EMI", "amount": 2400}],
            },
            "platform": {"monthly_net": [32800, 34200, 33100, 32200, 34700, 33600]},
            "invoice": {"on_road_price": 118000},
        }
        loan_request = {"amount": 95000, "tenureMonths": 36, "segment": "EV_2W"}

        one = compute_credit_metrics(evidence=evidence, loan_request=loan_request, policy=self.policy)
        two = compute_credit_metrics(evidence=evidence, loan_request=loan_request, policy=self.policy)
        self.assertEqual(one["metrics"], two["metrics"])
        self.assertEqual(one["input_hash"], two["input_hash"])

        moved = compute_credit_metrics(
            evidence=evidence, loan_request={**loan_request, "amount": 95001}, policy=self.policy
        )
        self.assertNotEqual(moved["input_hash"], one["input_hash"])

        self.assertEqual(
            one["metrics"]["foir"],
            calculate_foir(
                one["metrics"]["verified_monthly_income"],
                one["metrics"]["obligations"],
                one["metrics"]["emi"],
                4,
            ),
        )
        self.assertEqual(one["metrics"]["age_at_maturity"], 35)

        # Policy precedence
        clean = evaluate_policy(
            {
                "metrics": one["metrics"],
                "reconciliation": {"blocking": 0, "advisory": 0},
                "unresolvedLowConfidence": 0,
                "loanRequest": loan_request,
                "policy": self.policy,
            }
        )
        self.assertEqual(clean["decision"], "APPROVE")

        held = evaluate_policy(
            {
                "metrics": one["metrics"],
                "reconciliation": {"blocking": 0, "advisory": 0},
                "unresolvedLowConfidence": 2,
                "loanRequest": loan_request,
                "policy": self.policy,
            }
        )
        self.assertEqual(held["decision"], "REFER")
        self.assertTrue(any(c["code"] == "F01" for c in held["reason_codes"]))

        contradicted = evaluate_policy(
            {
                "metrics": one["metrics"],
                "reconciliation": {"blocking": 1, "advisory": 0},
                "unresolvedLowConfidence": 0,
                "loanRequest": loan_request,
                "policy": self.policy,
            }
        )
        self.assertEqual(contradicted["decision"], "REJECT")
        self.assertTrue(any(c["code"] == "R02" for c in contradicted["reason_codes"]))

        unaffordable = evaluate_policy(
            {
                "metrics": {**one["metrics"], "foir": 0.72},
                "reconciliation": {"blocking": 0, "advisory": 0},
                "unresolvedLowConfidence": 0,
                "loanRequest": loan_request,
                "policy": self.policy,
            }
        )
        self.assertEqual(unaffordable["decision"], "REJECT")
        self.assertTrue(any(c["code"] == "R01" for c in unaffordable["reason_codes"]))

        borderline = evaluate_policy(
            {
                "metrics": {**one["metrics"], "foir": 0.52},
                "reconciliation": {"blocking": 0, "advisory": 0},
                "unresolvedLowConfidence": 0,
                "loanRequest": loan_request,
                "policy": self.policy,
            }
        )
        self.assertEqual(borderline["decision"], "REFER")

        advisory_only = evaluate_policy(
            {
                "metrics": {**one["metrics"], "income_volatility": 0.95, "average_monthly_balance": 10},
                "reconciliation": {"blocking": 0, "advisory": 0},
                "unresolvedLowConfidence": 0,
                "loanRequest": loan_request,
                "policy": self.policy,
            }
        )
        self.assertEqual(advisory_only["decision"], "REFER")

        for eval_res in [clean, held, contradicted, unaffordable, borderline, advisory_only]:
            self.assertIn(eval_res["decision"], ["APPROVE", "REFER", "REJECT"])

        # What-If Exactness
        def eval_scenario(scenario):
            m = compute_credit_metrics(
                evidence=evidence,
                loan_request={**loan_request, "amount": scenario["amount"], "tenureMonths": scenario["tenureMonths"]},
                policy=self.policy,
            )
            e = evaluate_policy(
                {
                    "metrics": m["metrics"],
                    "reconciliation": {"blocking": 0, "advisory": 0},
                    "unresolvedLowConfidence": 0,
                    "loanRequest": {**loan_request, "amount": scenario["amount"], "tenureMonths": scenario["tenureMonths"]},
                    "policy": self.policy,
                }
            )
            return {"decision": e["decision"], "metrics": m["metrics"], "evaluation": e}

        over = {"amount": 112000, "tenureMonths": 36, "coApplicantIncome": 0}
        self.assertEqual(eval_scenario(over)["decision"], "REJECT")

        solved = solve_minimum_change(
            evaluate=eval_scenario, base_scenario=over, policy=self.policy, segment="EV_2W"
        )
        lever = next(l for l in solved["levers"] if l["id"] == "LOAN_AMOUNT")
        self.assertTrue(lever["feasible"])
        self.assertEqual(eval_scenario(lever["scenario"])["decision"], "APPROVE")
        self.assertNotEqual(
            eval_scenario({**lever["scenario"], "amount": lever["to"] + 500})["decision"],
            "APPROVE",
        )

    # ==================================================================
    # Reconciliation similarity
    # ==================================================================

    def test_reconciliation_similarity(self):
        self.assertEqual(name_similarity("Rahul Sharma", "RAHUL SHARMA"), 1)
        self.assertTrue(name_similarity("Rahul Sharma", "Sharma Rahul") > 0.95)
        self.assertTrue(name_similarity("Vikram Singh Rathore", "Vikram S Rathore") > 0.85)
        self.assertTrue(name_similarity("Vikram Singh Rathore", "Vikram Rathore") > 0.85)
        self.assertTrue(name_similarity("Lakshmi Narayanan", "Lakshmi Narayan") > 0.88)
        self.assertTrue(name_similarity("Lakshmi Narayanan", "Suresh Kumar Ramasamy") < 0.7)
        self.assertEqual(name_similarity("", "Rahul Sharma"), 0)

        self.assertTrue(
            address_similarity(
                "8-3-214, Nalgonda X Roads, Malakpet, Hyderabad 500036",
                "Malakpet, Hyderabad 500036",
            )
            > 0.9
        )
        self.assertTrue(
            address_similarity(
                "22/4 Cross Cut Road, Gandhipuram, Coimbatore 641012",
                "No 5, Perundurai Main Road, Erode 638052",
            )
            < 0.5
        )

    # ==================================================================
    # Audit ledger
    # ==================================================================

    def test_audit_ledger(self):
        l = create_ledger("TRC-TEST")
        l = append_event(
            l,
            {
                "stage": "APPLICATION_CREATED",
                "actor": "OFFICER",
                "summary": "one",
                "at": "2026-01-01T00:00:00.000Z",
            },
        )
        l = append_event(
            l,
            {
                "stage": "DECISION",
                "actor": "ENGINE",
                "summary": "two",
                "at": "2026-01-01T00:00:01.000Z",
            },
        )
        self.assertEqual(len(l["events"]), 2)
        self.assertTrue(verify_ledger(l)["ok"])
        self.assertEqual(l["events"][1]["prev"], l["events"][0]["digest"])
        self.assertEqual(l["head"], l["events"][1]["digest"])

        tampered = {
            **l,
            "events": [{**l["events"][0], "summary": "edited"}, l["events"][1]],
        }
        self.assertFalse(verify_ledger(tampered)["ok"])
        self.assertEqual(verify_ledger(tampered)["brokenAt"], 0)

        dropped = {**l, "events": [l["events"][1]]}
        self.assertFalse(verify_ledger(dropped)["ok"])

    # ==================================================================
    # Policy document integrity
    # ==================================================================

    def test_policy_document_integrity(self):
        self.assertTrue(all(r["severity"] in ["BLOCKING", "ADVISORY"] for r in self.policy["rules"]))
        for r in self.policy["rules"]:
            for code_key in ["reject_reason", "refer_reason", "pass_reason"]:
                c = r.get(code_key)
                if c:
                    self.assertIn(c, self.policy["reason_codes"])

        codes = [r["code"] for r in self.policy["rules"]]
        self.assertEqual(len(set(codes)), len(codes))

        self.assertTrue(
            all(
                r["refer_band"][0] >= r["threshold"]
                for r in self.policy["rules"]
                if r.get("refer_band") and r.get("operator") == "lte"
            )
        )
        self.assertTrue(
            all(not r.get("reject_reason") for r in self.policy["rules"] if r["severity"] == "ADVISORY")
        )
        self.assertTrue(
            all(
                s["min_ticket"] < s["max_ticket"]
                and s["tenure_months"]["min"] < s["tenure_months"]["max"]
                and s["rate_annual_pct"] > 0
                for s in self.policy["segments"].values()
            )
        )
        self.assertTrue(
            self.policy["confidence"]["critical_field_threshold"]
            > self.policy["confidence"]["field_threshold"]
        )


class TestEvidenceStrength(unittest.TestCase):
    """Evidence strength scores the file, never the borrower. It must move only
    when the evidence moves, and it must never reach the decision."""

    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads((ROOT / "policy" / "policy.v1.json").read_text(encoding="utf-8"))

    def bundle(self, *, months=6, platform=True, confidence=0.95):
        fields = {
            p: {"path": p, "confidence": confidence, "critical": True}
            for p in self.policy["confidence"]["critical_fields"]
        }
        fields["invoice.model"] = {"path": "invoice.model", "confidence": 0.99, "critical": False}
        values = {
            "bank": {"monthly_credits": [30000] * months},
            "invoice": {"on_road_price": 118000},
        }
        if platform:
            values["platform"] = {"monthly_net": [30000] * months}
        return fields, values

    def score(self, *, reconciliation=None, **kw):
        fields, values = self.bundle(**kw)
        return compute_evidence_strength(
            fields=fields,
            values=values,
            reconciliation=reconciliation or {"blocking": 0, "advisory": 0, "total": 8},
            policy=self.policy,
        )

    def test_a_complete_corroborated_file_scores_high(self):
        result = self.score()
        self.assertGreaterEqual(result["score"], 80)
        self.assertEqual(result["band"], "STRONG")
        self.assertEqual(sum(c["max"] for c in result["components"]), 100)

    def test_one_blocking_finding_empties_consistency(self):
        result = self.score(reconciliation={"blocking": 1, "advisory": 0, "total": 8})
        consistency = next(c for c in result["components"] if c["key"] == "consistency")
        self.assertEqual(consistency["points"], 0)
        self.assertIn("blocking", consistency["detail"])

    def test_confidence_below_the_policy_floor_earns_nothing(self):
        floor = self.policy["confidence"]["critical_field_threshold"]
        at_floor = self.score(confidence=floor)
        below = self.score(confidence=floor - 0.2)
        confidence_at = next(c for c in at_floor["components"] if c["key"] == "confidence")
        confidence_below = next(c for c in below["components"] if c["key"] == "confidence")
        self.assertEqual(confidence_at["points"], 0)
        self.assertEqual(confidence_below["points"], 0)  # clamped, never negative

    def test_a_single_source_scores_below_two_that_agree(self):
        self.assertLess(self.score(platform=False)["score"], self.score(platform=True)["score"])

    def test_short_history_reduces_coverage(self):
        short = next(c for c in self.score(months=2)["components"] if c["key"] == "coverage")
        full = next(c for c in self.score(months=6)["components"] if c["key"] == "coverage")
        self.assertLess(short["points"], full["points"])
        self.assertIn("2 of 6 months", short["detail"])

    def test_bands(self):
        self.assertEqual(band_for(100), "STRONG")
        self.assertEqual(band_for(80), "STRONG")
        self.assertEqual(band_for(79), "ADEQUATE")
        self.assertEqual(band_for(40), "THIN")
        self.assertEqual(band_for(0), "WEAK")

    def test_it_is_pure(self):
        fields, values = self.bundle()
        args = dict(fields=fields, values=values, reconciliation={"blocking": 0, "advisory": 0, "total": 8}, policy=self.policy)
        self.assertEqual(compute_evidence_strength(**args), compute_evidence_strength(**args))

    def test_thresholds_come_from_the_policy_not_the_engine(self):
        # Raise the confidence floor and the same evidence must score lower:
        # nothing in this function may hold a threshold of its own.
        strict = json.loads(json.dumps(self.policy))
        strict["confidence"]["critical_field_threshold"] = 0.97
        fields, values = self.bundle(confidence=0.95)
        lenient = compute_evidence_strength(
            fields=fields, values=values, reconciliation={"blocking": 0, "advisory": 0, "total": 8}, policy=self.policy
        )
        tightened = compute_evidence_strength(
            fields=fields, values=values, reconciliation={"blocking": 0, "advisory": 0, "total": 8}, policy=strict
        )
        self.assertLess(tightened["score"], lenient["score"])

    def test_an_empty_bundle_does_not_explode(self):
        result = compute_evidence_strength(fields={}, values={}, reconciliation=None, policy=self.policy)
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["band"], "WEAK")


if __name__ == "__main__":
    unittest.main()
