import { existsSync, writeFileSync } from "node:fs";
import { resolveCompletionUrl } from "../src/lib/task-contract";
import { getSql } from "../src/lib/db";
import { registrationInputs, registrationText } from "../src/lib/preregistration";
try { process.loadEnvFile(".env.local"); } catch { /* Host environment is supported. */ }

async function main() {
  if (existsSync("data/PREREGISTRATION.md")) throw new Error("Registration already exists and will not be replaced.");
  const input = registrationInputs();
  const modeArg = process.argv.find(arg => arg.startsWith("--completion-mode="))?.split("=")[1];
  if (modeArg !== "auto_approve" && modeArg !== "self_report" && modeArg !== "manual_review") throw new Error("Choose --completion-mode=auto_approve|self_report|manual_review from the actual draft response.");
  if (modeArg === "auto_approve" && !process.env.TERAC_COMPLETION_URL) throw new Error("Auto approval requires TERAC_COMPLETION_URL from the draft.");
  if (modeArg === "auto_approve") resolveCompletionUrl(process.env.TERAC_COMPLETION_URL!, {submissionId:"callback_validation",taskId:"callback_validation"});
  const sql = getSql();
  const [labels] = await sql`select count(*)::int as count from reviews where not is_test`;
  if (Number(labels.count) !== 0) throw new Error("Participant collection has already started. Registration cannot be created retroactively.");
  const [baselineCount] = await sql`select count(*)::int as count from decisions where agent_version = ${"v1"} and case_id = any(${input.baseline.map(r => r.case_id)}::text[])`;
  if (Number(baselineCount.count) !== 49) throw new Error("All 49 baseline decisions must be saved first.");
  const [quote] = await sql`select num_participants, quoted_cents_per_participant, meta from terac_jobs where purpose = ${"eval_round"} and status = ${"quoted"} order by id desc limit 1`;
  if (!quote || Number(quote.num_participants) !== input.assignment.participants) throw new Error("A matching quoted participant count is required.");
  const draft = quote.meta?.draft ?? quote.meta?.structuredContent ?? quote.meta;
  if (draft?.status !== "draft" || !draft.funding?.affordable || draft.tasks?.length !== 1 || draft.tasks[0].review_type !== modeArg || draft.tasks[0].duration_minutes !== (input.assignment.cards_per_reviewer === 8 ? 7 : 5) || draft.screening_questions?.length !== 0) throw new Error("The actual draft must match the registered task, review mode, duration and no-screener audience.");
  const cpiCents = Number(quote.quoted_cents_per_participant);
  if (draft.pricing?.cost_per_participant_cents !== cpiCents || draft.pricing.total_cost_cents !== cpiCents * input.assignment.participants) throw new Error("Quoted prices differ from the draft.");
  if (!Number.isInteger(cpiCents) || cpiCents <= 0 || cpiCents * input.assignment.participants > 9000) throw new Error("The quoted round must preserve the $10 reserve from the $100 balance.");
  if (cpiCents > 900 && input.assignment.cards_per_reviewer !== 6) throw new Error("The higher quote requires the shorter assignment design.");
  const text = registrationText(input, { cpiCents, completionMode: modeArg, registeredAt: new Date().toISOString() });
  writeFileSync("data/PREREGISTRATION.md", text, {flag:"wx"});
  console.log("Registration written. Commit the five frozen inputs and protocol before opening recruitment.");
}
main().catch(error => { console.error(error instanceof Error && !String(error.message).includes("://") ? error.message : "Registration validation failed."); process.exitCode = 1; });
