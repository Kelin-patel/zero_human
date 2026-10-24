"""Read-only collection health. Queries contain no evaluation answer columns."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from statistics import median
import time

from runtime import CUTOFF, ROOT, ReportError, iso, load_inputs, read_database, timestamp

ASSIGNMENTS_SQL = """
select slot, submission_id, task_id, assigned_at, is_test
from task_assignments order by slot
"""
# Only response metadata is selected, including the server's attention-check flag.
REVIEWS_SQL = """
select id, case_id, terac_submission_id, task_id, is_gold, gold_passed,
       seconds_spent, created_at, is_test
from reviews order by created_at, id
"""
ROUND_SQL = """
select status, num_participants, meta->>'lastPolledAt' as last_polled_at,
       meta->>'completedSubmissions' as completed_submissions,
       meta->>'pausedAt' as paused_at
from terac_jobs where purpose='eval_round' order by id desc limit 1
"""


def collection_health(inputs, assignments, reviews, now, stuck_minutes=10):
    now = timestamp(now)
    primary = {s["slot"]: s for s in inputs["primary"]}
    slots = {s["slot"]: s for s in inputs["assignment"]["slots"]}
    real = [a for a in assignments if a.get("submission_id") and not a.get("is_test") and not a["submission_id"].startswith("test_")]
    valid = [r for r in reviews if r["case_id"] in inputs["cases"] and not r.get("is_test") and not str(r.get("terac_submission_id", "")).startswith("test_") and timestamp(r["created_at"]) <= min(now, CUTOFF)]
    by_id, first = {}, {}
    for row in sorted(valid, key=lambda r: (timestamp(r["created_at"]), int(r["id"]))):
        first.setdefault((row["terac_submission_id"], row["case_id"]), row)
    for row in first.values():
        by_id.setdefault(row["terac_submission_id"], []).append(row)
    duplicate_pairs = Counter((r["case_id"], r["terac_submission_id"]) for r in valid)
    coverage = {key: 0 for key in inputs["evaluation"]}
    sessions, flags, durations = [], [], []
    for claim in real:
        slot = slots.get(claim["slot"])
        if not slot:
            flags.append({"slot": claim["slot"], "flag": "unknown_slot"})
            continue
        rows = [r for r in by_id.get(claim["submission_id"], []) if r["case_id"] in slot["case_ids"] and r.get("task_id") == claim.get("task_id")]
        ids = {r["case_id"] for r in rows}
        seconds = [r["seconds_spent"] for r in rows if isinstance(r.get("seconds_spent"), (int, float)) and r["seconds_spent"] >= 0]
        latest = max([timestamp(claim["assigned_at"])] + [timestamp(r["created_at"]) for r in rows])
        complete = set(slot["case_ids"]) <= ids
        gold = [r for r in rows if r["case_id"] in slot["case_ids"] and inputs["cases"][r["case_id"]]["set_name"] == "gold"]
        gold_status = "passed" if gold and all(r.get("gold_passed") is True for r in gold) else "failed" if gold and any(r.get("gold_passed") is False for r in gold) else "missing"
        session = {"slot": claim["slot"], "overflow": slot["overflow"], "saved": len(ids), "total": len(slot["case_ids"]), "complete": complete, "gold": gold_status, "median_seconds": median(seconds) if seconds else None, "idle_minutes": round((now-latest).total_seconds()/60, 1)}
        sessions.append(session)
        durations += seconds
        if not slot["overflow"]:
            for key in ids & coverage.keys():
                coverage[key] += 1
        if seconds and median(seconds) < 10:
            flags.append({"slot": claim["slot"], "flag": "median_under_10_seconds", "median_seconds": median(seconds)})
        if not complete and session["idle_minutes"] >= stuck_minutes:
            flags.append({"slot": claim["slot"], "flag": "stuck_session", "idle_minutes": session["idle_minutes"]})
    for (case, submission), count in duplicate_pairs.items():
        if count > 1:
            slot = next((a["slot"] for a in real if a["submission_id"] == submission), None)
            flags.append({"slot": slot, "case_id": case, "flag": "duplicate_response", "rows": count})
    main = [s for s in sessions if s["slot"] in primary]
    return {"observed_at": iso(now), "cutoff_utc": iso(CUTOFF), "cutoff_reached": now >= CUTOFF,
            "primary_slots_claimed": len(main), "primary_slots_total": len(primary),
            "complete_reviewers": sum(s["complete"] for s in main), "partial_reviewers": sum(not s["complete"] for s in main),
            "overflow_slots_claimed": sum(s["overflow"] for s in sessions),
            "gold": {state: sum(s["gold"] == state for s in main) for state in ("passed", "failed", "missing")}, "eval_cards_saved": coverage,
            "eval_coverage_counts": dict(Counter(str(min(n, 3)) for n in coverage.values())),
            "median_seconds_per_card": median(durations) if durations else None,
            "cards_under_10_seconds": sum(r.get("seconds_spent") is not None and 0 <= r["seconds_spent"] < 10 for r in valid),
            "sessions": sorted(sessions, key=lambda s: s["slot"]), "flags": flags,
            "test_rows_ignored": sum(bool(r.get("is_test")) or str(r.get("terac_submission_id", "")).startswith("test_") for r in reviews)}


def run_once():
    inputs = load_inputs()
    with read_database() as connection:
        now = connection.execute("select now() as now").fetchone()["now"]
        assignments = connection.execute(ASSIGNMENTS_SQL).fetchall()
        reviews = connection.execute(REVIEWS_SQL).fetchall()
        round_info = connection.execute(ROUND_SQL).fetchone()
    report = collection_health(inputs, assignments, reviews, now)
    report["round"] = dict(round_info) if round_info else None
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--watch", action="store_true", help="Print every ten minutes until the registered cutoff.")
    parser.add_argument("--interval", type=int, default=600)
    parser.add_argument("--output", type=str, help="Optional metadata-only JSON receipt.")
    args = parser.parse_args()
    if args.interval < 30:
        parser.error("Use an interval of at least 30 seconds.")
    while True:
        report = run_once()
        text = json.dumps(report, indent=2, sort_keys=True, allow_nan=False)
        print(text, flush=True)
        if args.output:
            from pathlib import Path
            Path(args.output).write_text(text + "\n", encoding="utf8")
        if not args.watch or report["cutoff_reached"]:
            return
        time.sleep(min(args.interval, max(1, (CUTOFF-datetime.now(timezone.utc)).total_seconds())))


if __name__ == "__main__":
    try:
        main()
    except ReportError as error:
        raise SystemExit(str(error)) from None
    except Exception:
        raise SystemExit("Collection monitor failed. Check the read-only database connection and frozen inputs; credentials and response contents were not logged.") from None
