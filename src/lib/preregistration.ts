import { readFileSync } from "node:fs";
import { z } from "zod";
import { canonicalJson, sha256 } from "./case-generation";
import { readFrozenBundle } from "./case-files";
import { Assignment, assertAssignment } from "./task-assignment";

const Baseline = z.array(z.object({
  case_id: z.string(), decision: z.enum(["approve", "deny", "out_of_scope"]),
  clauses: z.array(z.string()), reason: z.string(), votes: z.unknown(), dissent: z.unknown(),
}));
export const frozenNames = ["policy.v1.md", "cases.frozen.json", "prepared-review.config.json", "decisions_v1.json", "assignment.json"] as const;
export function registrationInputs() {
  const { records } = readFrozenBundle();
  const contents = Object.fromEntries(frozenNames.map(name => [name, readFileSync(`data/${name}`, "utf8")]));
  const hashes = Object.fromEntries(frozenNames.map(name => [name, sha256(contents[name])]));
  const assignment = Assignment.parse(JSON.parse(contents["assignment.json"]));
  assertAssignment(assignment, records);
  if (assignment.cases_sha256 !== hashes["cases.frozen.json"]) throw new Error("Assignment cases checksum differs.");
  const expectedIds = records.filter(r => r.set_name === "dev" || r.set_name === "eval").map(r => r.card.id).sort();
  const rawBaseline = JSON.parse(contents["decisions_v1.json"]);
  const baseline = Baseline.parse(rawBaseline);
  if (canonicalJson(rawBaseline) !== contents["decisions_v1.json"] || canonicalJson(baseline.map(r => r.case_id).sort()) !== canonicalJson(expectedIds)) throw new Error("Baseline must contain exactly the 49 frozen cases, in canonical JSON.");
  if (baseline.some(r => r.votes === undefined || r.dissent === undefined)) throw new Error("Baseline votes and dissent are required.");
  const config = JSON.parse(contents["prepared-review.config.json"]);
  if (config.policy_sha256 !== hashes["policy.v1.md"] || config.cases_sha256 !== hashes["cases.frozen.json"] || canonicalJson([...config.case_ids].sort()) !== canonicalJson(expectedIds) || config.decision_options?.limits?.maxRefundCents !== 19900) throw new Error("Prepared decision configuration differs.");
  return { assignment, baseline, hashes, records };
}

export function registrationText(input: ReturnType<typeof registrationInputs>, round: { cpiCents: number; completionMode: "auto_approve" | "self_report" | "manual_review"; registeredAt: string }): string {
  const { assignment, hashes, records } = input;
  const primary = assignment.slots.filter(s => !s.overflow);
  const assigned = primary.flatMap(s => s.case_ids);
  const counts = (set: string) => new Set(assigned.filter(id => records.find(r => r.card.id === id)?.set_name === set)).size;
  const evalCount = counts("eval"), devCount = counts("dev");
  return `# Refund decision evaluation: registered protocol

Registered at ${round.registeredAt}, before collecting participant responses. Prepared disputes concern Example Academy, a fictional online course store. This is a small pilot, and the human reference reflects policy judgments rather than legal rulings.

## Questions and decision rule

- **H1 (primary):** v2 makes fewer errors than v1 on held-out cases with human consensus. An error is any agent decision that differs from the binary human reference, including an out-of-scope answer.
- **H2 (guardrail):** v2 wrong approvals are no greater than v1 wrong approvals plus one.
- **H3 (descriptive):** report reviewer percent agreement and Cohen’s κ, including the sample size and undefined κ when a marginal has no variation.

Improvement is shown only if errors fall and the guardrail holds. Use exact McNemar, two-sided: an exact binomial test with probability 0.5 on the discordant matched pairs (v1 wrong/v2 right versus v1 right/v2 wrong). Report p < 0.05 as statistically significant; otherwise describe any improvement as directional pilot evidence. Report results regardless of outcome.

Report wrong denials (deny against approve consensus) and wrong approvals (approve against deny consensus) separately. Report total errors, out-of-scope answers, Wilson 95% confidence intervals for each error rate, consensus coverage, missing responses, ambiguity, gold pass rate, and all exclusions. With no discordant pairs, McNemar p = 1; with no consensus cases, report metrics unavailable.

## Frozen design and independent labels

The policy, case facts and split, model (claude-opus-5-5), three stances, dissent and re-vote architecture, decider effort, and random seeds stay fixed. Only interpretation notes and examples learned from development cases may change between v1 and v2. The learner must filter to development cases and exclude all test responses. Evaluation labels may be read only by the analysis program.

The baseline covers all 22 development and 27 evaluation cases, excluding gold. Both agent versions use the exact prepared-case options in [prepared-review.config.json](prepared-review.config.json): a $199 decision limit for these 49 cases only. Live and execution limits remain separate.

The quoted round uses **${assignment.participants} participants × ${assignment.cards_per_reviewer} cards**, with a machine-estimated draft quote of **$${(round.cpiCents / 100).toFixed(2)} per participant** (total **$${(round.cpiCents * assignment.participants / 100).toFixed(2)}**). Primary slots cover ${evalCount} distinct evaluation and ${devCount} distinct development cases, plus one rotating gold card per reviewer. Assignment uses mulberry32 seed 20261024 and arrival order; card order is frozen in [assignment.json](assignment.json). ${assignment.cards_per_reviewer === 8 ? "The full 11-person design gives each reviewer five evaluation, two development and one gold card: 27 evaluation cases twice, one additional evaluation rating, and all 22 development cases once." : "The shorter design selects 20 evaluation and 13 development cases by the same seeded shuffle, provides two evaluation ratings each plus two spare ratings, and one gold per reviewer; each slot contains six cards."} ${assignment.participants === 10 ? "Only the first ten primary slots are used; the eleventh slot is dropped. Missing double-label coverage is reported, with no data-driven replacement selection." : ""}

The first two scheduled primary slots for each evaluation case are its prespecified reference raters, in ascending slot order. Consensus requires both eligible raters to answer approve or both to answer deny. Split answers or need-more-evidence answers are ambiguous and excluded from H1 and H2; report their counts and policy clauses, and ambiguity as a fraction of the planned held-out cases. Missing or excluded raters are reported separately and do not yield consensus. Spare third labels do not break ties or replace failed raters; report them descriptively. Compute agreement and κ on eligible complete reference pairs, treating need_more_evidence as a separate category.

A reviewer fails attention checking if their gold response does not match the server-held binary gold answer, including need_more_evidence. Exclude all their answers from analysis. Report incomplete reviewers and incomplete gold checks separately. Test IDs start with test_ and are stored with is_test = true in both response tables; exclude them from every analysis. Overflow slots 12–16 contain evaluation cards only and are exploratory: they do not replace primary raters, enter the learner, or enter the primary metrics.

Reviewers see only the policy and neutral case facts, never AI decisions, reasons, hidden designer metadata, or gold answers. Each answer requires a decision, at least ten words of reasoning, confidence 1–5, and recorded time. Answers save individually and are final; reopening the same task resumes progress.

## Recruitment and stop rule

Audience: United States, age 18 or older, any language, with no screener. Task type: interview with the external task URL; review type: ${round.completionMode}. ${round.completionMode === "auto_approve" ? "The page redirects to the verified Terac completion callback after all assigned responses save." : round.completionMode === "manual_review" ? "Terac requires provider approval for this unscreened round. Reviewers return to Terac and mark the task complete; approval is performed through the Terac MCP after verifying that all assigned card identifiers have saved responses. Completion verification reads identifiers and counts only, never evaluation labels. Gold-based analytical exclusion does not determine payment." : "No completion callback was supplied by the draft; reviewers return to Terac and mark the task complete."} Duration: ${assignment.cards_per_reviewer === 8 ? 7 : 5} minutes. The quote and participant count must fit the funded balance while preserving a $10 reserve.

Stop recruitment at **17:30 America/New_York on October 24, 2026 (21:30 UTC)**, or when the target ${assignment.participants} participants have completed, whichever occurs first. Analyze the eligible responses saved by that cutoff. Report the actual completion count and any collection deviations. No extra recruitment or case selection based on observed labels. No screeners were used to avoid an additional interview delay. The external task type and completion mode follow the draft and the current no-screener launch requirements; this replaces the earlier activity and automatic-payment assumptions. A no-screener launch requires the provider’s organization capability and an explicit without_screener flag; if that capability is unavailable, recruitment must remain closed until a timestamped amendment documents a new design. The later stop time accommodates the actual launch window.

## SHA-256 commitments

Hashes are over exact file bytes (UTF-8, LF). These files must be committed on origin/main before recruitment. Do not rerun v1 or edit the frozen policy, cases, assignment, decision settings or baseline after registration.

| File | SHA-256 |
|---|---|
${frozenNames.map(name => `| ${name} | ${hashes[name]} |`).join("\n")}

Any later deviation must be appended as a timestamped amendment without replacing this protocol.
`.replace(/[ \t]+\n/g, "\n");
}
