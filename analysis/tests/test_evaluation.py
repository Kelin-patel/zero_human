"""Synthetic-only statistical and collection-integrity checks."""

import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ANALYSIS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ANALYSIS))
from runtime import CUTOFF, FOLLOWUP_CUTOFF, ROOT, ReportError, followup_window, load_inputs
import monitor
spec = importlib.util.spec_from_file_location("registered_eval", ANALYSIS / "eval.py")
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)

INPUTS = load_inputs()
START = datetime(2026, 10, 24, 21, 0, tzinfo=timezone.utc)


def fixture(labels=None, predictions=None):
    labels = labels or {key: row["decision"] for key, row in INPUTS["baseline"].items()}
    claims, reviews = [], []
    for slot in INPUTS["primary"]:
        number = slot["slot"]
        submission = f"synthetic_{number:02}"
        claims.append({"slot": number, "submission_id": submission, "task_id": "synthetic_task", "assigned_at": START, "is_test": False})
        for offset, key in enumerate(slot["case_ids"]):
            gold = INPUTS["cases"][key]["set_name"] == "gold"
            decision = INPUTS["cases"][key]["expected"] if gold else labels[key]
            reviews.append({"id": len(reviews)+1, "case_id": key, "terac_submission_id": submission, "task_id": "synthetic_task", "decision": decision,
                            "is_gold": gold, "gold_passed": True if gold else None, "seconds_spent": 30, "is_test": False, "created_at": START+timedelta(seconds=offset+1)})
    predictions = predictions if predictions is not None else {key: INPUTS["baseline"][key]["decision"] for key in INPUTS["evaluation"]}
    return {"observed_at": CUTOFF+timedelta(minutes=1), "assignments": claims, "reviews": reviews,
            "v2": [{"case_id": key, "decision": value} for key, value in predictions.items()], "data_kind": "synthetic_fixture", "round": {"status": "paused"}}


def refs(key):
    return sorted(s["slot"] for s in INPUTS["primary"] if key in s["case_ids"])


def response(snapshot, slot, key):
    return next(r for r in snapshot["reviews"] if r["terac_submission_id"] == f"synthetic_{slot:02}" and r["case_id"] == key)


class EvaluationTests(unittest.TestCase):
    def followup_fixture(self):
        snapshot = fixture()
        start = START+timedelta(minutes=40)
        window = {"kind":"followup","startedAt":start.isoformat(),"stopAt":FOLLOWUP_CUTOFF.isoformat()}
        snapshot["round"]["followup"] = window
        snapshot["observed_at"] = FOLLOWUP_CUTOFF+timedelta(seconds=1)
        for row in snapshot["assignments"]:
            row["assigned_at"] += timedelta(minutes=40)
        for row in snapshot["reviews"]:
            row["created_at"] += timedelta(minutes=40)
        for row in snapshot["v2"]:
            row["meta"] = {"collectionWindow":window}
        return snapshot

    def test_followup_late_data_never_changes_registered_analysis(self):
        snapshot = self.followup_fixture()
        self.assertEqual(evaluation.analyze_snapshot(INPUTS, snapshot)["sample"]["consensus_cases"],0)
        result = evaluation.analyze_snapshot(INPUTS, snapshot, followup=True)
        self.assertEqual(result["sample"]["consensus_cases"],27)
        self.assertEqual(result["analysis_kind"],"exploratory_followup")
        self.assertIn("EXPLORATORY FOLLOW-UP",result["summary"])

    def test_followup_includes_hard_stop_but_excludes_later_data(self):
        snapshot = self.followup_fixture()
        row = next(r for r in snapshot["reviews"] if r["case_id"] in INPUTS["evaluation"])
        row["created_at"] = FOLLOWUP_CUTOFF
        self.assertEqual(evaluation.analyze_snapshot(INPUTS,snapshot,True)["sample"]["consensus_cases"],27)
        row["created_at"] += timedelta(microseconds=1)
        self.assertEqual(evaluation.analyze_snapshot(INPUTS,snapshot,True)["sample"]["consensus_cases"],26)

    def test_followup_requires_confirmed_resume_and_matching_model_window(self):
        with self.assertRaises(ReportError):
            followup_window(INPUTS,{})
        snapshot = self.followup_fixture()
        snapshot["v2"][0]["meta"]["collectionWindow"] = {"kind":"registered"}
        with self.assertRaisesRegex(ReportError,"provenance"):
            evaluation.analyze_snapshot(INPUTS,snapshot,True)

    def test_followup_ignores_pre_resume_and_test_responses(self):
        snapshot = self.followup_fixture()
        row = next(r for r in snapshot["reviews"] if r["case_id"] in INPUTS["evaluation"])
        row["created_at"] = START
        result = evaluation.analyze_snapshot(INPUTS,snapshot,True)
        self.assertEqual(result["sample"]["consensus_cases"],26)
        self.assertEqual(result["exclusions"]["before_followup_response"],1)
        for row in snapshot["reviews"]:
            row["is_test"] = True
        self.assertEqual(evaluation.analyze_snapshot(INPUTS,snapshot,True)["sample"]["consensus_cases"],0)

    def test_completed_database_outputs_wait_for_the_frozen_artifact(self):
        snapshot = fixture()
        snapshot["v2_artifact"] = {"available": False, "sha256": None}
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["status"], "awaiting_v2_artifact")
        self.assertTrue(result["v2"]["complete"])
        self.assertIsNone(result["comparison"])
        self.assertIn("artifact is not yet available", result["summary"])
        self.assertNotIn("run is incomplete", result["summary"])

    def test_artifact_validation_requires_exact_case_coverage_and_database_match(self):
        snapshot = fixture()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "decisions_v2.json"
            self.assertFalse(evaluation.validate_v2_artifact(INPUTS, snapshot["v2"], path)["available"])
            path.write_text(json.dumps(snapshot["v2"]))
            self.assertTrue(evaluation.validate_v2_artifact(INPUTS, snapshot["v2"], path)["available"])
            changed = copy.deepcopy(snapshot["v2"])
            changed[0]["decision"] = "deny" if changed[0]["decision"] == "approve" else "approve"
            path.write_text(json.dumps(changed))
            with self.assertRaisesRegex(ReportError, "differs from database"):
                evaluation.validate_v2_artifact(INPUTS, snapshot["v2"], path)
            path.write_text(json.dumps(snapshot["v2"][:-1]))
            with self.assertRaisesRegex(ReportError, "exactly the 27"):
                evaluation.validate_v2_artifact(INPUTS, snapshot["v2"], path)

    def test_exact_mcnemar_known_examples_and_no_discordance(self):
        self.assertAlmostEqual(evaluation.exact_mcnemar(9, 1), .021484375)
        self.assertAlmostEqual(evaluation.exact_mcnemar(1, 9), .021484375)
        self.assertEqual(evaluation.exact_mcnemar(0, 0), 1)
        self.assertAlmostEqual(evaluation.exact_mcnemar(7, 0), .015625)

    def test_no_errors_has_nonzero_wilson_upper_bound(self):
        result = evaluation.analyze_snapshot(INPUTS, fixture())
        self.assertEqual(result["sample"]["consensus_cases"], 27)
        self.assertEqual(result["comparison"]["v1"]["errors"], 0)
        self.assertGreater(result["comparison"]["v1"]["error_rate_wilson_95"][1], 0)
        self.assertEqual(result["comparison"]["mcnemar_exact_two_sided_p"], 1)
        self.assertFalse(result["comparison"]["improvement_shown"])
        self.assertEqual(result["agreement"]["cohens_kappa"], 1)
        self.assertIn("SYNTHETIC TEST FIXTURE", result["summary"])

    def test_nine_fixes_one_regression_gives_registered_improvement(self):
        base = {key: row["decision"] for key, row in INPUTS["baseline"].items()}
        corrections = [key for key in INPUTS["evaluation"] if base[key] == "deny"][:9]
        self.assertEqual(len(corrections), 9)
        regression = next(key for key in INPUTS["evaluation"] if base[key] == "approve")
        labels, predictions = dict(base), {key: base[key] for key in INPUTS["evaluation"]}
        for key in corrections:
            labels[key] = predictions[key] = "approve"
        predictions[regression] = "deny"
        result = evaluation.analyze_snapshot(INPUTS, fixture(labels, predictions))
        comparison = result["comparison"]
        self.assertEqual(comparison["v1"]["wrong_denials"], 9)
        self.assertEqual(comparison["v2"]["wrong_denials"], 1)
        self.assertEqual(comparison["discordant"], {"v1_wrong_v2_right": 9, "v1_right_v2_wrong": 1})
        self.assertAlmostEqual(comparison["mcnemar_exact_two_sided_p"], .021484375)
        self.assertTrue(comparison["improvement_shown"])
        self.assertTrue(comparison["approval_guardrail_passed"])

    def test_wrong_approval_guardrail_and_out_of_scope_are_counted(self):
        snapshot = fixture()
        denies = [row for row in snapshot["v2"] if row["decision"] == "deny"]
        denies[0]["decision"] = denies[1]["decision"] = "approve"
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["comparison"]["v2"]["wrong_approvals"], 2)
        self.assertFalse(result["comparison"]["approval_guardrail_passed"])
        denies[1]["decision"] = "out_of_scope"
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["comparison"]["v2"]["out_of_scope"], 1)
        self.assertEqual(result["comparison"]["v2"]["errors"], 2)
        self.assertTrue(result["comparison"]["approval_guardrail_passed"])

    def test_split_and_need_more_evidence_are_ambiguous(self):
        snapshot = fixture()
        first, second = INPUTS["evaluation"][:2]
        row = response(snapshot, refs(first)[1], first)
        row["decision"] = "deny" if row["decision"] == "approve" else "approve"
        for slot in refs(second)[:2]:
            response(snapshot, slot, second)["decision"] = "need_more_evidence"
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["ambiguous_cases"], 2)
        self.assertEqual(result["sample"]["consensus_cases"], 25)
        self.assertEqual(result["agreement"]["pairs"], 27)
        self.assertEqual(result["agreement"]["agreements"], 26)

    def test_spare_third_label_cannot_break_reference_tie(self):
        snapshot = fixture()
        key = next(key for key in INPUTS["evaluation"] if len(refs(key)) == 3)
        reference = refs(key)
        response(snapshot, reference[0], key)["decision"] = "approve"
        response(snapshot, reference[1], key)["decision"] = "deny"
        response(snapshot, reference[2], key)["decision"] = "approve"
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["ambiguous_cases"], 1)
        self.assertEqual(result["spare_third_ratings"]["eligible"], 1)
        self.assertEqual(result["spare_third_ratings"]["not_comparable"], 1)

    def test_failed_and_missing_gold_exclude_reviewers(self):
        snapshot = fixture()
        gold = next(r for r in snapshot["reviews"] if r["terac_submission_id"] == "synthetic_01" and r["is_gold"])
        gold["decision"] = "deny" if gold["decision"] == "approve" else "approve"
        gold["gold_passed"] = False
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["gold"]["failed"], 1)
        self.assertEqual(result["exclusions"]["failed_gold_reviewer_response"], 8)
        self.assertEqual(result["sample"]["consensus_cases"], 22)
        snapshot["reviews"].remove(gold)
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["gold"]["missing"], 1)
        self.assertEqual(result["sample"]["consensus_cases"], 22)

    def test_gold_passing_partial_reviewer_keeps_available_cards(self):
        snapshot = fixture()
        row = next(r for r in snapshot["reviews"] if r["terac_submission_id"] == "synthetic_01" and r["case_id"] in INPUTS["evaluation"])
        snapshot["reviews"].remove(row)
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["eligible_partial_reviewers"], 1)
        self.assertEqual(result["sample"]["consensus_cases"], 26)
        self.assertTrue(result["sample"]["partial_collection"])

    def test_gold_metadata_mismatch_cannot_create_eligibility(self):
        snapshot = fixture()
        gold = next(r for r in snapshot["reviews"] if r["terac_submission_id"] == "synthetic_01" and r["is_gold"])
        gold["gold_passed"] = False
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["gold"]["invalid_metadata"], 1)
        self.assertEqual(result["sample"]["consensus_cases"], 22)

    def test_cutoff_boundary_includes_exact_time_but_excludes_later(self):
        snapshot = fixture()
        row = next(r for r in snapshot["reviews"] if r["case_id"] in INPUTS["evaluation"])
        row["created_at"] = CUTOFF
        self.assertEqual(evaluation.analyze_snapshot(INPUTS, snapshot)["sample"]["consensus_cases"], 27)
        row["created_at"] += timedelta(microseconds=1)
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["consensus_cases"], 26)
        self.assertEqual(result["exclusions"]["after_cutoff_response"], 1)

    def test_delivery_target_stop_does_not_depend_on_gold_quality(self):
        snapshot = fixture()
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        expected = max(r["created_at"] for r in snapshot["reviews"])
        self.assertEqual(result["effective_cutoff_utc"], expected.isoformat().replace("+00:00", "Z"))
        next(r for r in snapshot["reviews"] if r["is_gold"])["decision"] = "need_more_evidence"
        next(r for r in snapshot["reviews"] if r["is_gold"])["gold_passed"] = False
        self.assertEqual(evaluation.analyze_snapshot(INPUTS, snapshot)["effective_cutoff_utc"], result["effective_cutoff_utc"])

    def test_test_flags_and_prefixes_never_enter_analysis(self):
        snapshot = fixture()
        for claim in snapshot["assignments"]:
            claim["is_test"] = True
        for row in snapshot["reviews"]:
            row["is_test"] = True
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["claimed_primary_reviewers"], 0)
        self.assertEqual(result["sample"]["consensus_cases"], 0)
        self.assertIsNone(result["comparison"])
        self.assertEqual(result["exclusions"]["test_response"], 88)
        for claim in snapshot["assignments"]:
            claim["is_test"] = False
            claim["submission_id"] = "test_"+claim["submission_id"]
        for row in snapshot["reviews"]:
            row["is_test"] = False
            row["terac_submission_id"] = "test_"+row["terac_submission_id"]
        self.assertEqual(evaluation.analyze_snapshot(INPUTS, snapshot)["sample"]["consensus_cases"], 0)

    def test_partial_v2_does_not_select_a_favorable_comparison_subset(self):
        snapshot = fixture()
        snapshot["v2"].pop()
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["consensus_cases"], 27)
        self.assertIsNone(result["comparison"])
        self.assertEqual(result["status"], "awaiting_v2")

    def test_kappa_is_unavailable_with_constant_marginal(self):
        self.assertIsNone(evaluation.agreement([])["cohens_kappa"])
        self.assertIsNone(evaluation.agreement([("approve", "approve"), ("approve", "deny")])["cohens_kappa"])

    def test_later_duplicate_never_replaces_original(self):
        snapshot = fixture()
        repeated = copy.deepcopy(next(r for r in snapshot["reviews"] if r["case_id"] in INPUTS["evaluation"]))
        repeated.update(id=1000, created_at=repeated["created_at"]+timedelta(seconds=1), decision="need_more_evidence")
        snapshot["reviews"].append(repeated)
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertEqual(result["sample"]["consensus_cases"], 27)
        self.assertEqual(result["exclusions"]["duplicate_later_response"], 1)

    def test_invalid_v2_inputs_are_rejected(self):
        snapshot = fixture()
        snapshot["v2"][0]["policy_sha256"] = "wrong"
        with self.assertRaises(ReportError):
            evaluation.analyze_snapshot(INPUTS, snapshot)

    def test_no_consensus_chart_is_valid_png_and_never_fabricates_metrics(self):
        snapshot = fixture()
        snapshot["assignments"] = []
        snapshot["reviews"] = []
        result = evaluation.analyze_snapshot(INPUTS, snapshot)
        self.assertIsNone(result["comparison"])
        self.assertIsNone(result["baseline_on_consensus"])
        self.assertIn("no improvement is claimed", result["summary"])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"chart.png"
            evaluation.render_chart(result, path)
            self.assertTrue(path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))
            result = evaluation.analyze_snapshot(INPUTS, fixture())
            evaluation.render_chart(result, path)
            self.assertGreater(path.stat().st_size, 10000)
        json.dumps(result, allow_nan=False)

    def test_registered_checksum_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT/"data", root/"data")
            (root/"data/assignment.json").write_text("{}\n")
            with self.assertRaises(ReportError):
                load_inputs(root)


class MonitorTests(unittest.TestCase):
    def test_query_selects_no_answer_columns(self):
        import re
        self.assertIsNone(re.search(r"\b(decision|reason|confidence)\b", monitor.REVIEWS_SQL))

    def test_unclaimed_slots_and_empty_collection_work(self):
        claims = [{"slot":s["slot"], "submission_id":None, "assigned_at":None, "is_test":False} for s in INPUTS["primary"]]
        report = monitor.collection_health(INPUTS, claims, [], START)
        self.assertEqual(report["primary_slots_claimed"], 0)
        self.assertEqual(report["complete_reviewers"], 0)
        self.assertEqual(report["eval_coverage_counts"], {"0":27})

    def test_speed_duplicates_and_stuck_are_flags_not_exclusions(self):
        snapshot = fixture()
        claim = snapshot["assignments"][0]
        row = next(r for r in snapshot["reviews"] if r["terac_submission_id"] == claim["submission_id"])
        row["seconds_spent"] = 2
        report = monitor.collection_health(INPUTS, [claim], [row, dict(row, id=999)], START+timedelta(minutes=20))
        self.assertEqual({f["flag"] for f in report["flags"]}, {"median_under_10_seconds", "duplicate_response", "stuck_session"})
        self.assertEqual(report["sessions"][0]["saved"], 1)


if __name__ == "__main__":
    unittest.main()
