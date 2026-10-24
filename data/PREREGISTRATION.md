# Refund decision evaluation: registered protocol

Registered at 2026-10-24T20:05:21.101Z, before collecting participant responses. Prepared disputes concern Example Academy, a fictional online course store. This is a small pilot, and the human reference reflects policy judgments rather than legal rulings.

## Questions and decision rule

- **H1 (primary):** v2 makes fewer errors than v1 on held-out cases with human consensus. An error is any agent decision that differs from the binary human reference, including an out-of-scope answer.
- **H2 (guardrail):** v2 wrong approvals are no greater than v1 wrong approvals plus one.
- **H3 (descriptive):** report reviewer percent agreement and Cohen’s κ, including the sample size and undefined κ when a marginal has no variation.

Improvement is shown only if errors fall and the guardrail holds. Use exact McNemar, two-sided: an exact binomial test with probability 0.5 on the discordant matched pairs (v1 wrong/v2 right versus v1 right/v2 wrong). Report p < 0.05 as statistically significant; otherwise describe any improvement as directional pilot evidence. Report results regardless of outcome.

Report wrong denials (deny against approve consensus) and wrong approvals (approve against deny consensus) separately. Report total errors, out-of-scope answers, Wilson 95% confidence intervals for each error rate, consensus coverage, missing responses, ambiguity, gold pass rate, and all exclusions. With no discordant pairs, McNemar p = 1; with no consensus cases, report metrics unavailable.

## Frozen design and independent labels

The policy, case facts and split, model (claude-opus-5-5), three stances, dissent and re-vote architecture, decider effort, and random seeds stay fixed. Only interpretation notes and examples learned from development cases may change between v1 and v2. The learner must filter to development cases and exclude all test responses. Evaluation labels may be read only by the analysis program.

The baseline covers all 22 development and 27 evaluation cases, excluding gold. Both agent versions use the exact prepared-case options in [prepared-review.config.json](prepared-review.config.json): a $199 decision limit for these 49 cases only. Live and execution limits remain separate.

The quoted round uses **11 participants × 8 cards**, with a machine-estimated draft quote of **$6.00 per participant** (total **$66.00**). Primary slots cover 27 distinct evaluation and 22 distinct development cases, plus one rotating gold card per reviewer. Assignment uses mulberry32 seed 20261024 and arrival order; card order is frozen in [assignment.json](assignment.json). The full 11-person design gives each reviewer five evaluation, two development and one gold card: 27 evaluation cases twice, one additional evaluation rating, and all 22 development cases once.

The first two scheduled primary slots for each evaluation case are its prespecified reference raters, in ascending slot order. Consensus requires both eligible raters to answer approve or both to answer deny. Split answers or need-more-evidence answers are ambiguous and excluded from H1 and H2; report their counts and policy clauses, and ambiguity as a fraction of the planned held-out cases. Missing or excluded raters are reported separately and do not yield consensus. Spare third labels do not break ties or replace failed raters; report them descriptively. Compute agreement and κ on eligible complete reference pairs, treating need_more_evidence as a separate category.

A reviewer fails attention checking if their gold response does not match the server-held binary gold answer, including need_more_evidence. Exclude all their answers from analysis. Report incomplete reviewers and incomplete gold checks separately. Test IDs start with test_ and are stored with is_test = true in both response tables; exclude them from every analysis. Overflow slots 12–16 contain evaluation cards only and are exploratory: they do not replace primary raters, enter the learner, or enter the primary metrics.

Reviewers see only the policy and neutral case facts, never AI decisions, reasons, hidden designer metadata, or gold answers. Each answer requires a decision, at least ten words of reasoning, confidence 1–5, and recorded time. Answers save individually and are final; reopening the same task resumes progress.

## Recruitment and stop rule

Audience: United States, age 18 or older, any language, with no screener. Task type: interview with the external task URL; review type: manual_review. Terac requires provider approval for this unscreened round. Reviewers return to Terac and mark the task complete; approval is performed through the Terac MCP after verifying that all assigned card identifiers have saved responses. Completion verification reads identifiers and counts only, never evaluation labels. Gold-based analytical exclusion does not determine payment. Duration: 7 minutes. The quote and participant count must fit the funded balance while preserving a $10 reserve.

Stop recruitment at **17:30 America/New_York on October 24, 2026 (21:30 UTC)**, or when the target 11 participants have completed, whichever occurs first. Analyze the eligible responses saved by that cutoff. Report the actual completion count and any collection deviations. No extra recruitment or case selection based on observed labels. No screeners were used to avoid an additional interview delay. The external task type and completion mode follow the draft and the current no-screener launch requirements; this replaces the earlier activity and automatic-payment assumptions. A no-screener launch requires the provider’s organization capability and an explicit without_screener flag; if that capability is unavailable, recruitment must remain closed until a timestamped amendment documents a new design. The later stop time accommodates the actual launch window.

## SHA-256 commitments

Hashes are over exact file bytes (UTF-8, LF). These files must be committed on origin/main before recruitment. Do not rerun v1 or edit the frozen policy, cases, assignment, decision settings or baseline after registration.

| File | SHA-256 |
|---|---|
| policy.v1.md | f7a43b279cb717b6b94d578e060bf92c5fd86f7d3d3701a870f815cb4114bf5a |
| cases.frozen.json | d48ac95bf219a98a40f9219482263f0d93a44032124c0c82fdac7d306b832662 |
| prepared-review.config.json | 36815b067145b1bc1a61a1f2d4731cd0cd64ea7c8174914d18c703ad7fd6c6bd |
| decisions_v1.json | e261015364c5efdfbc3064cbf0198c2f43ccc330f11883de226e01db401360db |
| assignment.json | d77b876c0cff715a9853825a59824eb476df51e56af51a0ae69455cef0d74a93 |

Any later deviation must be appended as a timestamped amendment without replacing this protocol.

## Amendment 1 — 2026-10-24 16:43 America/New_York (before any human response)

The participant platform refused the unscreened launch: launching without a screener is not enabled for this organization (PRECONDITION_FAILED). No participant was recruited and nothing was charged. To proceed, the draft now has exactly one broad screening question, added before launch:

- Question: "How often do you buy things online?" (single choice)
- Qualifying answers: "Weekly or more", "A few times a month", "A few times a year". Rejecting answer: "Never".

Because a screener is present, the platform runs its own short screening interview before inviting applicants. This may reduce completions before the cutoff. Everything else is unchanged: the US adult audience, interview task type with manual_review and completion-based approval, 11 participants at the same quoted price, 8 cards and 7 minutes, assignment, frozen inputs, baseline, metrics, exclusion rules and the 17:30 America/New_York stop time. The earlier statements that no screener is used are superseded by this amendment. The actual number of completions by the cutoff will be reported.
