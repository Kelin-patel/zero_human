# Refund evaluation reports

Install the pinned Python dependencies in a virtual environment. The database URL comes from `DATABASE_URL` or the ignored repository `.env.local`; never put credentials in a command or report.

```bash
python -m pip install -r analysis/requirements.txt
python analysis/monitor.py
python analysis/monitor.py --watch
python analysis/eval.py
python -m unittest discover -s analysis/tests -v
```

Both tools open a read-only, repeatable-read database transaction. The monitor selects identifiers, timing and server attention-check metadata only. Only `eval.py` queries held-out human choices. Neither tool writes to the database, recruits reviewers, approves payments or runs a model.

`eval.py` verifies the five hashes in [the registered protocol](../data/PREREGISTRATION.md), then writes `results.json`, `chart.png` and `summary.md` here. The JSON records the chart checksum, current protocol hash, input hashes, source timestamps, coverage and every exclusion. No submission IDs, reviewer reasons or binary per-case human references are published. The chart and summary clearly distinguish an interim collection snapshot from an available paired comparison.

Reference raters are the two lowest scheduled primary slot numbers for each held-out case, fixed before collection. Passing gold makes a reviewer's available answers eligible, even if that reviewer has not finished every card; a missing or failed gold check makes their answers ineligible. Incomplete delivery is reported separately. Spare third ratings and overflow reviews never replace a missing/failed primary rater or break a tie. Speed flags and duplicate flags are reported; speed alone is not an exclusion. Duplicate retries retain the first saved answer.

The cutoff is October 24, 2026 at 21:30 UTC, or the delivery of all assigned cards by all eleven primary reviewers if earlier. Answers after the effective cutoff cannot enter the reference. An early target stop is computed from delivery metadata, independent of gold correctness. Test flags and `test_` identifiers are excluded independently. Amendment 1's required online-shopping screener and platform interview are included in the caveats.

The comparison requires all 27 v2 predictions, so an incomplete v2 run cannot select a favorable subset. A missing v2 artifact is reported as pending. With no eligible consensus, metrics are null rather than zero. With no discordant pairs, exact McNemar p is one. Cohen's kappa is unavailable if either reference-rater marginal has no variation. Error-rate confidence intervals use Wilson's method; chart whiskers apply to the total error rate.

The unit suite constructs synthetic labels in memory, including a known 9-to-1 discordance example, failed/missing gold, incomplete reviewers, ties, need-more-evidence, late responses, test rows and incomplete model outputs. Synthetic CLI snapshots must use `--fixture <path> --output-dir <directory-outside-repository>`; their reports are prominently labeled as synthetic tests and cannot overwrite this report bundle.

Re-run the evaluation after the registered cutoff and once the frozen v2 artifact is available. Do not rerun v1 or change the frozen cases, policy, assignment or decision settings.
