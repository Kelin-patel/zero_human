"""Registered paired evaluation. This is the only reader of held-out human answers."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
import os
import tempfile
from pathlib import Path
from statistics import median

from runtime import (BINARY, CUTOFF, DECISIONS, ROOT, ReportError, digest,
                     git_commit, iso, load_inputs, read_database, timestamp, write_json)

HUMAN_CHOICES = BINARY | {"need_more_evidence"}


def exact_mcnemar(b, c):
    from scipy.stats import binomtest
    return float(binomtest(min(b, c), b+c, 0.5, alternative="two-sided").pvalue) if b+c else 1.0


def wilson(errors, total):
    if total == 0:
        return None
    from statsmodels.stats.proportion import proportion_confint
    lo, hi = proportion_confint(errors, total, alpha=0.05, method="wilson")
    return [float(lo), float(hi)]


def agreement(pairs):
    if not pairs:
        return {"pairs": 0, "agreements": 0, "percent": None, "cohens_kappa": None, "kappa_unavailable_reason": "No eligible reference pairs."}
    first, second = zip(*pairs)
    matches = sum(a == b for a, b in pairs)
    kappa, reason = None, None
    if len(set(first)) < 2 or len(set(second)) < 2:
        reason = "At least one reference-rater marginal has no variation."
    else:
        from sklearn.metrics import cohen_kappa_score
        value = float(cohen_kappa_score(first, second, labels=["approve", "deny", "need_more_evidence"]))
        if math.isfinite(value):
            kappa = value
        else:
            reason = "Kappa is undefined for these reference pairs."
    return {"pairs": len(pairs), "agreements": matches, "percent": 100*matches/len(pairs), "cohens_kappa": kappa, "kappa_unavailable_reason": reason}


def score_agent(predictions, reference):
    errors = {"wrong_denials": 0, "wrong_approvals": 0, "out_of_scope": 0}
    for key, expected in reference.items():
        decision = predictions[key]
        if decision == expected:
            continue
        if decision == "out_of_scope":
            errors["out_of_scope"] += 1
        elif decision == "deny":
            errors["wrong_denials"] += 1
        else:
            errors["wrong_approvals"] += 1
    total = sum(errors.values())
    n = len(reference)
    return {**errors, "errors": total, "cases": n, "error_rate": total/n if n else None, "error_rate_wilson_95": wilson(total, n)}


def fetch_snapshot(inputs):
    # Do not move this query into a shared repository helper or the live monitor.
    with read_database() as connection:
        observed = connection.execute("select now() as now").fetchone()["now"]
        assignments = connection.execute("select slot, submission_id, task_id, assigned_at, is_test from task_assignments order by slot").fetchall()
        reviews = connection.execute("""
            select id, case_id, terac_submission_id, task_id, decision, is_gold,
                   gold_passed, seconds_spent, is_test, created_at
            from reviews where case_id = any(%s) order by created_at, id
        """, (list(inputs["cases"]),)).fetchall()
        v2 = connection.execute("""
            select case_id, decision, policy_sha256, meta from decisions
            where agent_version='v2' and case_id = any(%s) order by case_id
        """, (inputs["evaluation"],)).fetchall()
        round_info = connection.execute("""
            select status, num_participants, meta->>'lastPolledAt' as last_polled_at,
                   meta->>'pausedAt' as paused_at, meta->>'pauseReason' as pause_reason
            from terac_jobs where purpose='eval_round' order by id desc limit 1
        """).fetchone()
    return {"observed_at": observed, "assignments": assignments, "reviews": reviews, "v2": v2,
            "round": dict(round_info) if round_info else None, "data_kind": "real_collection"}


def validate_v2(inputs, rows):
    predictions = {}
    for row in rows:
        key = row["case_id"]
        if key not in inputs["evaluation"] or key in predictions or row["decision"] not in DECISIONS:
            raise ReportError("A v2 decision has an unknown/repeated identifier or invalid output.")
        if row.get("policy_sha256") and row["policy_sha256"] != inputs["hashes"]["policy.v1.md"]:
            raise ReportError("A v2 decision used a different policy.")
        meta = row.get("meta") or {}
        if meta.get("model") and meta["model"] != "claude-opus-5-5":
            raise ReportError("A v2 decision used a different model.")
        if meta.get("configSha256") and meta["configSha256"] != inputs["hashes"]["prepared-review.config.json"]:
            raise ReportError("A v2 decision used a different prepared configuration.")
        if meta.get("decisionOptions") and meta["decisionOptions"].get("limits", {}).get("maxRefundCents") != 19900:
            raise ReportError("A v2 decision used a different prepared limit.")
        predictions[key] = row["decision"]
    return predictions


def validate_v2_artifact(inputs, rows, path):
    if not path.exists():
        return {"available": False, "sha256": None}
    raw = path.read_bytes()
    artifact = json.loads(raw)
    if not isinstance(artifact, list) or sorted(r["case_id"] for r in artifact) != inputs["evaluation"]:
        raise ReportError("The v2 artifact must contain exactly the 27 held-out cases.")
    recorded = {r["case_id"]: r["decision"] for r in rows}
    if any(recorded.get(r["case_id"]) != r["decision"] for r in artifact):
        raise ReportError("The v2 artifact differs from database decisions.")
    return {"available": True, "sha256": digest(raw)}


def analyze_snapshot(inputs, snapshot):
    observed = timestamp(snapshot["observed_at"])
    excluded = Counter()
    primary = {s["slot"]: s for s in inputs["primary"]}
    slots = {s["slot"]: s for s in inputs["assignment"]["slots"]}
    claims, by_submission = {}, {}
    for claim in snapshot["assignments"]:
        submission = claim.get("submission_id")
        if not submission or claim.get("is_test") or submission.startswith("test_"):
            continue
        if claim["slot"] not in slots:
            excluded["unknown_assignment"] += 1
            continue
        if claim["slot"] in claims or submission in by_submission:
            raise ReportError("A real submission has conflicting assignment claims.")
        claims[claim["slot"]] = claim
        by_submission[submission] = claim

    earliest = {}
    for row in sorted(snapshot["reviews"], key=lambda r: (timestamp(r["created_at"]), int(r["id"]))):
        submission = str(row.get("terac_submission_id") or "")
        if row.get("is_test") or submission.startswith("test_"):
            excluded["test_response"] += 1
            continue
        claim = by_submission.get(submission)
        if not claim:
            excluded["unassigned_submission_response"] += 1
            continue
        if row["case_id"] not in slots[claim["slot"]]["case_ids"] or row.get("task_id") != claim.get("task_id"):
            excluded["unassigned_card_or_task_response"] += 1
            continue
        created = timestamp(row["created_at"])
        if created > observed:
            excluded["after_snapshot_response"] += 1
            continue
        if created < timestamp(claim["assigned_at"]):
            excluded["before_assignment_response"] += 1
            continue
        key = (claim["slot"], row["case_id"])
        if key in earliest:
            # Answers are final after their first successful save, independent of content.
            excluded["duplicate_later_response"] += 1
            continue
        earliest[key] = row

    # Derive an early target stop from delivery metadata, never from answer correctness.
    completion_times = []
    for number, slot in primary.items():
        delivered = [earliest.get((number, key)) for key in slot["case_ids"]]
        if all(delivered):
            completion_times.append(max(timestamp(row["created_at"]) for row in delivered))
    target_stop = max(completion_times) if len(completion_times) == len(primary) else None
    effective_cutoff = min(CUTOFF, target_stop) if target_stop else CUTOFF
    window_end = min(observed, effective_cutoff)
    saved = {}
    for key, row in earliest.items():
        if timestamp(row["created_at"]) > window_end:
            excluded["after_cutoff_response"] += 1
        elif row["decision"] not in HUMAN_CHOICES:
            excluded["invalid_human_choice"] += 1
        else:
            saved[key] = row

    reviewers, eligible_slots = [], set()
    for number, claim in sorted(claims.items()):
        if timestamp(claim["assigned_at"]) > window_end:
            excluded["after_cutoff_assignment"] += 1
            continue
        slot = slots[number]
        rows = {key: saved[(number, key)] for key in slot["case_ids"] if (number, key) in saved}
        gold_ids = [key for key in slot["case_ids"] if inputs["cases"][key]["set_name"] == "gold"]
        status = "not_applicable" if slot["overflow"] else "missing"
        if gold_ids and gold_ids[0] in rows:
            gold = rows[gold_ids[0]]
            correct = gold["decision"] == inputs["cases"][gold_ids[0]]["expected"]
            if not gold.get("is_gold") or gold.get("gold_passed") is not correct:
                status = "invalid_gold_metadata"
            else:
                status = "passed" if correct else "failed"
        eligible = not slot["overflow"] and status == "passed"
        if eligible:
            eligible_slots.add(number)
        elif slot["overflow"]:
            excluded["overflow_response"] += len(rows)
        elif status == "failed":
            excluded["failed_gold_reviewer_response"] += len(rows)
        else:
            excluded["missing_or_invalid_gold_reviewer_response"] += len(rows)
        seconds = [r["seconds_spent"] for r in rows.values() if isinstance(r.get("seconds_spent"), (int, float)) and r["seconds_spent"] >= 0]
        reviewers.append({"slot": number, "overflow": slot["overflow"], "saved_cards": len(rows),
                          "assigned_cards": len(slot["case_ids"]), "delivery_complete": len(rows) == len(slot["case_ids"]),
                          "gold": status, "eligible": eligible, "median_seconds": median(seconds) if seconds else None,
                          "speeder_flag": bool(seconds and median(seconds) < 10)})

    reference, pairs, case_audit = {}, [], []
    missing_reasons = Counter()
    extras = {"planned": 0, "saved": 0, "eligible": 0, "agrees_with_primary_consensus": 0, "not_comparable": 0}
    ambiguous_clauses = Counter()
    for key in inputs["evaluation"]:
        scheduled = sorted(number for number, slot in primary.items() if key in slot["case_ids"])
        ref_slots = scheduled[:2]
        ref_rows = []
        for number in ref_slots:
            if number not in claims or timestamp(claims[number]["assigned_at"]) > window_end:
                missing_reasons["unclaimed_reference_slot"] += 1
                ref_rows.append(None)
            elif number not in eligible_slots:
                missing_reasons["gold_ineligible_reference"] += 1
                ref_rows.append(None)
            elif (number, key) not in saved:
                missing_reasons["missing_reference_card"] += 1
                ref_rows.append(None)
            else:
                ref_rows.append(saved[(number, key)])
        state = "missing"
        if all(ref_rows):
            a, b = (row["decision"] for row in ref_rows)
            pairs.append((a, b))
            if a == b and a in BINARY:
                state = "consensus"
                reference[key] = a
            else:
                state = "ambiguous"
                ambiguous_clauses.update(set(inputs["baseline"][key].get("clauses") or []))
        case_audit.append({"case_id": key, "reference_slots": ref_slots, "eligible_ratings": sum(row is not None for row in ref_rows), "status": state})
        for number in scheduled[2:]:
            extras["planned"] += 1
            if (number, key) in saved:
                extras["saved"] += 1
                if number in eligible_slots:
                    extras["eligible"] += 1
                    if key in reference:
                        extras["agrees_with_primary_consensus"] += saved[(number, key)]["decision"] == reference[key]
                    else:
                        extras["not_comparable"] += 1

    v1 = {key: row["decision"] for key, row in inputs["baseline"].items()}
    v2 = validate_v2(inputs, snapshot.get("v2", []))
    baseline_metrics = score_agent(v1, reference) if reference else None
    v2_complete = len(v2) == len(inputs["evaluation"])
    artifact_available = snapshot.get("v2_artifact", {}).get("available", True)
    comparison = None
    if reference and v2_complete and artifact_available:
        revised = score_agent(v2, reference)
        b = sum(v1[key] != target and v2[key] == target for key, target in reference.items())
        c = sum(v1[key] == target and v2[key] != target for key, target in reference.items())
        guardrail = revised["wrong_approvals"] <= baseline_metrics["wrong_approvals"] + 1
        pvalue = exact_mcnemar(b, c)
        reduced = revised["errors"] < baseline_metrics["errors"]
        comparison = {"v1": baseline_metrics, "v2": revised, "discordant": {"v1_wrong_v2_right": b, "v1_right_v2_wrong": c},
                      "mcnemar_exact_two_sided_p": pvalue, "errors_reduced": reduced, "approval_guardrail_passed": guardrail,
                      "improvement_shown": reduced and guardrail, "statistically_significant_error_change": pvalue < 0.05}
    main_reviewers = [r for r in reviewers if not r["overflow"]]
    complete = sum(r["delivery_complete"] for r in main_reviewers)
    gold_counts = Counter(r["gold"] for r in main_reviewers)
    observed_gold = gold_counts["passed"] + gold_counts["failed"]
    consensus = len(reference)
    ambiguity = sum(row["status"] == "ambiguous" for row in case_audit)
    after_cutoff = observed >= effective_cutoff
    status = "interim_collection" if not after_cutoff else "no_consensus" if not reference else "awaiting_v2" if not v2_complete else "awaiting_v2_artifact" if not artifact_available else "complete_partial" if complete < len(primary) else "complete"
    results = {
        "schema_version": 1, "data_kind": snapshot.get("data_kind", "synthetic_fixture"), "status": status,
        "generated_at": iso(observed), "registered_cutoff_utc": iso(CUTOFF), "effective_cutoff_utc": iso(effective_cutoff),
        "cutoff_reached": after_cutoff, "round": snapshot.get("round"),
        "frozen_inputs_sha256": inputs["hashes"], "protocol_sha256": inputs["protocol_sha256"],
        "sample": {"target_reviewers": len(primary), "claimed_primary_reviewers": len(main_reviewers), "completed_primary_reviewers": complete,
                   "partial_primary_reviewers": sum(not r["delivery_complete"] for r in main_reviewers), "eligible_reviewers": len(eligible_slots),
                   "eligible_partial_reviewers": sum(r["eligible"] and not r["delivery_complete"] for r in main_reviewers),
                   "partial_collection": complete < len(primary), "planned_eval_cases": len(inputs["evaluation"]), "consensus_cases": consensus,
                   "ambiguous_cases": ambiguity, "missing_reference_cases": len(inputs["evaluation"])-consensus-ambiguity,
                   "consensus_coverage": consensus/len(inputs["evaluation"]), "ambiguity_rate_planned_cases": ambiguity/len(inputs["evaluation"])},
        "gold": {"pass_rate": gold_counts["passed"]/len(main_reviewers) if main_reviewers else None, "denominator_reviewers": len(main_reviewers), "passed": gold_counts["passed"], "failed": gold_counts["failed"], "missing": gold_counts["missing"],
                 "invalid_metadata": gold_counts["invalid_gold_metadata"], "pass_rate_of_answered": gold_counts["passed"]/observed_gold if observed_gold else None,
                 "pass_rate_of_claimed": gold_counts["passed"]/len(main_reviewers) if main_reviewers else None},
        "agreement": agreement(pairs), "baseline_on_consensus": baseline_metrics, "comparison": comparison,
        "v2": {"recorded_cases": len(v2), "expected_cases": len(inputs["evaluation"]), "complete": v2_complete,
               "artifact_available": artifact_available, "artifact_sha256": snapshot.get("v2_artifact", {}).get("sha256")},
        "exclusions": dict(sorted(excluded.items())), "missing_reference_ratings": dict(sorted(missing_reasons.items())),
        "reference_case_coverage": case_audit, "reviewers": reviewers, "spare_third_ratings": extras,
        "ambiguous_cases_by_v1_cited_clause": dict(sorted(ambiguous_clauses.items())),
        "caveats": ["Prepared synthetic cases and a fictional store.", "Small pilot; a general-population policy reference, not a legal ruling.",
                    "Only development labels may inform the learner; held-out labels are used only by this analysis.",
                    "Partial saved cards from a gold-passing reviewer remain eligible; missing gold is ineligible. Speed flags are descriptive, not additional exclusions."],
    }
    if inputs["amendment_1"]:
        results["caveats"].append("Amendment 1 added a broad online-shopping screener and the platform screening interview before recruitment, which may reduce completions before cutoff.")
    if snapshot.get("data_kind") != "real_collection":
        results["caveats"].insert(0, "SYNTHETIC TEST FIXTURE — not human study results.")
    results["summary"] = plain_summary(results)
    return results


def plain_summary(results):
    sample = results["sample"]
    n = sample["consensus_cases"]
    timing = "by the registered cutoff" if results["cutoff_reached"] else "so far; collection is still in progress"
    prefix = "SYNTHETIC TEST FIXTURE. " if results["data_kind"] != "real_collection" else ""
    if not n:
        context = ""
        if results["cutoff_reached"]:
            context = " The baseline, assignments and registered input hashes are verified; the human panel remains pending."
            if any("Amendment 1" in caveat for caveat in results["caveats"]):
                context += " Amendment 1 records the platform-required screener and screening interview before invitation."
        return prefix + f"No held-out cases have two eligible prespecified reference ratings {timing}. {sample['completed_primary_reviewers']} of {sample['target_reviewers']} reviewers have completed their assigned cards. Error rates, McNemar, reviewer agreement, kappa and the approval guardrail are unavailable. Test responses are excluded; no improvement is claimed." + context
    comparison = results["comparison"]
    if not comparison:
        errors = results["baseline_on_consensus"]["errors"]
        if results["v2"]["complete"] and not results["v2"]["artifact_available"]:
            return prefix + f"On {n} held-out cases with eligible human consensus {timing}, v1 made {errors} errors. All 27 v2 database outputs are present, but the frozen v2 artifact is not yet available. The paired comparison and approval guardrail remain pending; no improvement is claimed."
        return prefix + f"On {n} held-out cases with eligible human consensus {timing}, v1 made {errors} errors. The v2 run is incomplete ({results['v2']['recorded_cases']}/{results['v2']['expected_cases']} outputs), so the registered paired comparison and approval guardrail are unavailable. This is a partial pilot snapshot, not evidence of improvement."
    first, second = comparison["v1"], comparison["v2"]
    direction = "fell" if second["errors"] < first["errors"] else "rose" if second["errors"] > first["errors"] else "stayed unchanged"
    guard = "held" if comparison["approval_guardrail_passed"] else "failed"
    conclusion = "The reduction meets the improvement rule" if comparison["improvement_shown"] else "The improvement rule was not met"
    if comparison["improvement_shown"]:
        conclusion += " and is statistically significant" if comparison["mcnemar_exact_two_sided_p"] < .05 else "; the evidence is directional pilot evidence"
    return prefix + (f"On {n} held-out cases with eligible human consensus {timing}, errors {direction} from {first['errors']} to {second['errors']} "
                     f"(exact two-sided McNemar p = {comparison['mcnemar_exact_two_sided_p']:.4g}). Wrong approvals changed from {first['wrong_approvals']} to {second['wrong_approvals']}; the approval guardrail {guard}. "
                     f"{conclusion}. {sample['completed_primary_reviewers']}/{sample['target_reviewers']} reviewers completed; {sample['ambiguous_cases']} cases were ambiguous and {sample['missing_reference_cases']} lacked eligible reference pairs. This is a small synthetic-case pilot.")


def render_chart(results, path):
    os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".mplconfig"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import PercentFormatter
    figure, (axis, info) = plt.subplots(1, 2, figsize=(12, 6), gridspec_kw={"width_ratios": [1.8, 1]})
    figure.patch.set_facecolor("#fafbfc")
    for panel in (axis, info):
        panel.set_facecolor("#fafbfc")
    try:
        comparison = results["comparison"]
        n = results["sample"]["consensus_cases"]
        title = "Refund decision errors on held-out consensus cases"
        if results["data_kind"] != "real_collection":
            title = "SYNTHETIC TEST — " + title
        figure.suptitle(title, x=.06, ha="left", fontsize=18, fontweight="bold", color="#152b3c")
        stage = "Registered cutoff reached" if results["cutoff_reached"] else "Interim · collection in progress"
        figure.text(.06, .88, f"{stage}  |  {n} consensus cases", fontsize=12, color="#526473")
        if n:
            metrics = [comparison["v1"], comparison["v2"]] if comparison else [results["baseline_on_consensus"]]
            colors = [("wrong_denials", "Wrong denials", "#0072B2"), ("wrong_approvals", "Wrong approvals", "#D55E00"), ("out_of_scope", "Out of scope", "#858d94")]
            for i, metric in enumerate(metrics):
                bottom = 0
                for key, label, color in colors:
                    value = metric[key]/n
                    axis.bar(i, value, bottom=bottom, width=.5, color=color, label=label if i == 0 else None)
                    bottom += value
                lo, hi = metric["error_rate_wilson_95"]
                axis.errorbar(i, bottom, yerr=[[max(0, bottom-lo)], [max(0, hi-bottom)]], color="#172e3d", capsize=6, linewidth=1.5)
            axis.set_xticks([0, 1], [f"v1\n{metrics[0]['errors']}/{n} errors", f"v2\n{metrics[1]['errors']}/{n} errors" if comparison else "v2\npending"])
            if not comparison:
                pending = "Awaiting frozen\nv2 artifact" if results["v2"]["complete"] else "Awaiting complete\nv2 outputs"
                axis.text(1, .25, pending, ha="center", color="#647684")
            axis.set_xlim(-.65, 1.65)
            axis.set_ylim(0, 1.08)
            axis.yaxis.set_major_formatter(PercentFormatter(1))
            axis.set_ylabel("Error rate")
            axis.grid(axis="y", alpha=.15)
            axis.set_axisbelow(True)
            axis.legend(frameon=False, loc="upper left", bbox_to_anchor=(0, -.17), ncols=3, fontsize=9)
        else:
            axis.axis("off")
            axis.text(.5, .55, "No eligible human consensus yet", ha="center", va="center", fontsize=17, color="#526473", transform=axis.transAxes)
            axis.text(.5, .36, "Error rates and confidence intervals are unavailable.\nNo before/after improvement is claimed.", ha="center", va="center", fontsize=11, color="#647684", transform=axis.transAxes)
        info.axis("off")
        sample = results["sample"]
        agreement_result = results["agreement"]
        lines = ["Reference coverage", f"Completed reviewers   {sample['completed_primary_reviewers']} / {sample['target_reviewers']}", f"Consensus cases   {n} / {sample['planned_eval_cases']}", f"Ambiguous cases   {sample['ambiguous_cases']}", f"Missing reference pairs   {sample['missing_reference_cases']}", f"Gold passed / failed   {results['gold']['passed']} / {results['gold']['failed']}", "", "Reviewer agreement", f"Agreement   {agreement_result['percent']:.1f}%" if agreement_result["percent"] is not None else "Agreement   unavailable", f"Cohen’s κ   {agreement_result['cohens_kappa']:.3f}" if agreement_result["cohens_kappa"] is not None else "Cohen’s κ   undefined", "", f"Exact McNemar p   {comparison['mcnemar_exact_two_sided_p']:.4g}" if comparison else "Exact McNemar p   unavailable", f"Approval guardrail   {'PASS' if comparison['approval_guardrail_passed'] else 'FAIL'}" if comparison else "Approval guardrail   unassessed"]
        info.text(.04, .98, "\n".join(lines), transform=info.transAxes, va="top", fontsize=11, linespacing=1.6, color="#213f50")
        figure.text(.06, .06, "Whiskers: 95% Wilson intervals for total error rates. Prepared synthetic cases; small pilot. Test rows excluded.", fontsize=9, color="#526473")
        figure.subplots_adjust(left=.07, right=.98, top=.80, bottom=.22, wspace=.27)
        figure.savefig(path, dpi=180, facecolor=figure.get_facecolor(), metadata={"Description": "Registered refund evaluation; " + results["status"]})
    finally:
        plt.close(figure)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "analysis")
    parser.add_argument("--fixture", type=Path, help="Synthetic snapshot only; requires a separate output directory.")
    args = parser.parse_args()
    inputs = load_inputs()
    if args.fixture:
        if args.output_dir.resolve().is_relative_to(ROOT):
            parser.error("Synthetic fixtures require --output-dir outside the repository.")
        snapshot = json.loads(args.fixture.read_text(encoding="utf8"))
        snapshot["data_kind"] = "synthetic_fixture"
    else:
        snapshot = fetch_snapshot(inputs)
        snapshot["v2_artifact"] = validate_v2_artifact(inputs, snapshot["v2"], ROOT / "data/decisions_v2.json")
    results = analyze_snapshot(inputs, snapshot)
    results["registration_commit"] = git_commit("data/PREREGISTRATION.md", first=True)
    results["protocol_current_commit"] = git_commit("data/PREREGISTRATION.md")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".report-", dir=args.output_dir) as directory:
        staging = Path(directory)
        render_chart(results, staging / "chart.png")
        results["chart_sha256"] = digest((staging / "chart.png").read_bytes())
        write_json(staging / "results.json", results)
        (staging / "summary.md").write_text(results["summary"] + "\n", encoding="utf8")
        # Publish the JSON last, after its chart is complete and checksummed.
        for name in ("chart.png", "summary.md", "results.json"):
            os.replace(staging / name, args.output_dir / name)
    print(results["summary"])
    print(json.dumps({"status": results["status"], "consensus_cases": results["sample"]["consensus_cases"], "v2_complete": results["v2"]["complete"], "cutoff_utc": results["effective_cutoff_utc"]}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except ReportError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Evaluation failed. Check the read-only connection and frozen artifacts; credentials and human response contents were not logged.") from None
