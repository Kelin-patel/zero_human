import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, sha256 } from "../src/lib/case-generation";
import { readFrozenBundle } from "../src/lib/case-files";
import { getSql } from "../src/lib/db";
import { LEARNER_DRY_RUN_FILE, LearnerOutput, assertDevelopmentFeedback, assertLearningWindow, learnerPrompt, renderNotes, selectLearnerInputs, validateLearnerOutput } from "../src/lib/learner";
import { STOP_AT } from "../src/lib/terac-data";
import { MODEL, structured } from "../src/lib/llm";
import { loadPreparedInputs, validateBaseline } from "../src/lib/prepared-baseline";

loadEnvConfig(process.cwd());
const DRY_RUN_NOTES = resolve(LEARNER_DRY_RUN_FILE);

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--dry-run", "--include-test"].includes(arg))) throw new Error("Usage: npm run learn [-- --dry-run [--include-test]]");
  const dryRun = args.includes("--dry-run");
  const useTestRows = args.includes("--include-test");
  if (useTestRows && !dryRun) throw new Error("Test rows are not human labels; --include-test requires --dry-run.");

  const inputs = loadPreparedInputs();
  const baseline = validateBaseline(JSON.parse(readFileSync(resolve("data/decisions_v1.json"), "utf8")), inputs.config.case_ids);
  const devCards = readFrozenBundle().records.filter(r => r.set_name === "dev").map(r => r.card);
  const devIds = devCards.map(card => card.id);
  const assignment = JSON.parse(readFileSync(resolve("data/assignment.json"), "utf8")) as { slots: { slot: number; overflow: boolean }[] };
  const primarySlots = assignment.slots.filter(s => !s.overflow).map(s => s.slot);
  const sql = getSql();

  if (!dryRun) {
    const [existing] = await sql`SELECT (SELECT count(*)::int FROM agent_notes WHERE version = 'v2') AS notes,
      (SELECT count(*)::int FROM decisions WHERE agent_version = 'v2') AS decisions`;
    if (existing.notes > 0 || existing.decisions > 0) throw new Error("v2 notes or decisions already exist; the learner runs once.");
  }
  const [round] = await sql`SELECT status, num_participants, meta->>'completedSubmissions' AS completed, now() AS observed_at FROM terac_jobs WHERE purpose = 'eval_round' ORDER BY id DESC LIMIT 1`;
  assertLearningWindow({dryRun, nowMs: round?.observed_at ? new Date(round.observed_at).getTime() : Date.now(),
    cutoffMs: Date.parse(STOP_AT), roundStatus: round?.status ?? "none",
    completedParticipants: Number(round?.completed ?? 0), targetParticipants: Number(round?.num_participants ?? 0)});
  console.log(`[learn] review round status: ${round?.status ?? "none"}; rows: ${useTestRows ? "test" : "human"}; dry run: ${dryRun}`);

  // Only development and gold rows are queried. Evaluation labels never leave the database here.
  const reviewers = await sql`SELECT submission_id, slot, is_test FROM task_assignments WHERE submission_id IS NOT NULL`;
  const gold = await sql`SELECT terac_submission_id, gold_passed FROM reviews WHERE is_gold AND is_test = ${useTestRows}
    AND (${useTestRows} OR created_at <= ${STOP_AT}::timestamptz)`;
  const labels = await sql`SELECT terac_submission_id, case_id, decision, reason, confidence FROM reviews
    WHERE case_id = ANY(${devIds}::text[]) AND NOT is_gold AND is_test = ${useTestRows}
      AND (${useTestRows} OR created_at <= ${STOP_AT}::timestamptz)`;
  const selected = selectLearnerInputs({
    primarySlots, devCards, baseline, useTestRows,
    reviewers: reviewers.map(r => ({ submissionId: r.submission_id, slot: Number(r.slot), isTest: r.is_test })),
    gold: gold.map(g => ({ submissionId: g.terac_submission_id, goldPassed: g.gold_passed })),
    labels: labels.map(l => ({ submissionId: l.terac_submission_id, caseId: l.case_id, decision: l.decision, reason: l.reason, confidence: l.confidence })),
  });
  console.log(`[learn] eligible reviewers=${selected.eligibleReviewers} dev labels=${selected.devLabels} agreements=${selected.agreements} disagreements=${selected.disagreements.length}`);
  // The learner runs once. Storing empty notes without any human signal would use up that run.
  if (!dryRun && selected.eligibleReviewers === 0) {
    throw new Error("No eligible human reviewers yet (primary slot and passed gold); nothing was stored.");
  }
  assertDevelopmentFeedback(dryRun, selected.devLabels);

  let output: LearnerOutput = { notes: [], examples: [] };
  let usage = { input: 0, output: 0 };
  if (selected.disagreements.length) {
    const prompt = learnerPrompt(inputs.policy.text, selected);
    const result = await structured({ schema: LearnerOutput, effort: "high", label: "learner", ...prompt });
    usage = { input: result.usage.input, output: result.usage.output };
    if (!result.data) throw new Error(`Learner returned no valid notes (stop=${result.stopReason}, refused=${result.refused}).`);
    output = result.data;
  }
  const allowed = selected.disagreements.map(d => d.caseId);
  const sourceCaseIds = validateLearnerOutput(output, allowed);
  const notesText = renderNotes(output);
  const notesSha256 = sha256(notesText);
  const estimatedUsd = (4 * usage.input + 20 * usage.output) / 1_000_000;

  console.log(`\n${notesText || (selected.disagreements.length ? "(no notes: no disagreement was supportable from the policy)" : "(no notes: no development disagreements)")}\n`);
  console.log(canonicalJson({ notes: output.notes.length, examples: output.examples.length, sourceCaseIds, notesSha256, usage, estimatedUsd }));

  if (dryRun) {
    mkdirSync(".baseline-runs", { recursive: true });
    writeFileSync(DRY_RUN_NOTES, canonicalJson({ notesText, notesSha256, output, useTestRows, sourceCaseIds }));
    console.log(`[learn] dry run: nothing written to the database; notes saved to ${DRY_RUN_NOTES}`);
    return;
  }

  // The database re-confirms every source is a development case before anything is stored.
  if (sourceCaseIds.length) {
    const sets = await sql`SELECT id, set_name FROM cases WHERE id = ANY(${sourceCaseIds}::text[])`;
    if (sets.length !== sourceCaseIds.length || sets.some(row => row.set_name !== "dev")) throw new Error("A note source is not a development case.");
  }
  const meta = { model: MODEL, usage, estimatedUsd, notesSha256, sourceCaseIds, notes: output.notes,
    eligibleReviewers: selected.eligibleReviewers, devLabels: selected.devLabels, agreements: selected.agreements,
    disagreements: selected.disagreements.length, policySha256: inputs.policy.sha256 };
  const reason = `${output.notes.length} notes and ${output.examples.length} examples from ${selected.disagreements.length} development disagreements`;
  const [stored] = await sql`
    WITH inserted AS (
      INSERT INTO agent_notes (version, notes, examples, source_case_ids)
      SELECT 'v2', ${notesText}, ${JSON.stringify(output.examples)}::jsonb, ${sourceCaseIds}::text[]
      WHERE NOT EXISTS (SELECT 1 FROM agent_notes WHERE version = 'v2')
      RETURNING id
    ), booked AS (
      INSERT INTO ledger (actor, decision, reason, cost_cents, meta, env)
      SELECT 'learner', 'learn', ${reason}, ${Math.ceil(estimatedUsd * 100)}, ${JSON.stringify(meta)}::jsonb || jsonb_build_object('agentNotesId', id), 'sandbox'
      FROM inserted RETURNING id
    )
    SELECT (SELECT id FROM inserted) AS notes_id, (SELECT id FROM booked) AS ledger_id`;
  if (!stored?.notes_id) throw new Error("v2 notes were written concurrently by another run; nothing stored.");
  console.log(`[learn] stored agent_notes id=${stored.notes_id} (v2) and ledger id=${stored.ledger_id}`);
}

main().catch(error => {
  console.error("Learner stopped:", error instanceof Error ? error.message.replace(/(?:https?:\/\/|postgres\w*:\/\/)\S+/g, "[URL redacted]") : "unknown failure");
  process.exitCode = 1;
});
