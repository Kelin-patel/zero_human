import { loadEnvConfig } from "@next/env";
import { getSql } from "../src/lib/db";
import { canonicalJson } from "../src/lib/case-generation";
import { assertFollowupNote, FOLLOWUP_STOP_AT } from "../src/lib/followup";
import { loadRegisteredReview } from "../src/lib/registration";
import { opportunityObject, parseOpportunity } from "../src/lib/terac-data";
import { assertTeracHost, runTerac } from "../src/lib/terac-headless";

loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--follow-up") || args.some(a => !["--follow-up", "--check"].includes(a))) throw new Error("Usage: npm run terac:resume -- --follow-up [--check]");
  if (Date.now() >= Date.parse(FOLLOWUP_STOP_AT)) throw new Error("The follow-up hard stop has passed; resume is blocked.");
  assertFollowupNote();
  const registration = loadRegisteredReview(11, 8);
  const sql = getSql();
  const [row] = await sql`SELECT * FROM terac_jobs WHERE purpose = 'eval_round' ORDER BY id DESC LIMIT 1`;
  if (!row || !["paused", "resume_unknown"].includes(row.status)) throw new Error("Only the existing paused opportunity can be resumed.");
  const ready = row.meta?.followupWorker;
  if (ready?.stopAt !== FOLLOWUP_STOP_AT || !ready.readyAt || !Number.isFinite(Date.parse(ready.readyAt)) || Date.now() - Date.parse(ready.readyAt) > 600000) {
    throw new Error("Restart the single updated worker on the authenticated host first; its follow-up capability has not been recorded recently.");
  }
  assertTeracHost();
  const inspected = await runTerac(`Read terac_get_opportunity for opportunityId=${JSON.stringify(row.opportunity_id)}. Return {"opportunity":raw_response}. Do not change anything.`, ["terac_get_opportunity"]);
  const before = opportunityObject(inspected.response.opportunity);
  const plan = parseOpportunity(before);
  if (plan.id !== row.opportunity_id || plan.n !== 11 || plan.cpiCents !== 600 || plan.totalCents !== 6600 || plan.cardsPerReviewer !== 8 || plan.reviewType !== "manual_review" || plan.taskUrl !== row.meta?.plan?.taskUrl) {
    throw new Error("The existing prepaid opportunity differs from the unchanged review design.");
  }
  const reconciling = row.status === "resume_unknown" && before.status === "active";
  if (before.status !== "paused" && !reconciling) throw new Error("Terac has not confirmed the existing opportunity is paused.");
  if (args.includes("--check")) {
    console.log(JSON.stringify({ready:true,opportunityId:plan.id,additionalCostCents:0,n:plan.n,stopAt:FOLLOWUP_STOP_AT,registrationCommit:registration.registrationCommit})); return;
  }
  const claimed = await sql`UPDATE terac_jobs SET status = 'resuming' WHERE id = ${row.id} AND status IN ('paused','resume_unknown') RETURNING id`;
  if (!claimed.length) throw new Error("Another process claimed this resume.");
  try {
    const response = reconciling ? inspected : await runTerac(`Resume only opportunityId=${JSON.stringify(plan.id)} with terac_resume_opportunity, then read it with terac_get_opportunity. This free action continues only the eleven already-paid places. Do not launch a new draft, change targeting, tasks, screening or price, or approve/reject anyone. Return {"opportunity":raw_get_opportunity_response}.`, ["terac_resume_opportunity", "terac_get_opportunity"]);
    const actual = opportunityObject(response.response.opportunity);
    const resumed = parseOpportunity(actual);
    if (resumed.id !== plan.id || resumed.status !== "active" || resumed.n !== plan.n || resumed.cpiCents !== plan.cpiCents || resumed.totalCents !== plan.totalCents ||
        ["tasks","filters","screening_questions","customer_screening_review"].some(k => canonicalJson(actual[k]) !== canonicalJson(before[k]))) {
      throw new Error("Terac did not confirm the same unchanged opportunity as active.");
    }
    const startedAt = new Date(String(actual.updated_at)).toISOString();
    if (Date.parse(startedAt) >= Date.parse(FOLLOWUP_STOP_AT)) throw new Error("The confirmed resume falls outside the follow-up window.");
    const followup = { startedAt, stopAt:FOLLOWUP_STOP_AT, classification:"exploratory_followup", registrationCommit:registration.registrationCommit,
      registeredPauseAt:row.meta?.pausedAt ?? null, additionalCostCents:0 };
    await sql.transaction([
      sql`UPDATE terac_jobs SET status='launched', meta=meta || ${JSON.stringify({followup})}::jsonb WHERE id=${row.id} AND status='resuming'`,
      sql`INSERT INTO ledger (actor,decision,reason,cost_cents,meta,env) VALUES ('orchestrator','resume','Continue the same prepaid panel for a separately reported exploratory follow-up',0,${JSON.stringify({teracJobId:row.id,opportunityId:plan.id,...followup})}::jsonb,'live')`,
      sql`INSERT INTO jobs (kind,payload) VALUES ('review',${JSON.stringify({purpose:"eval_round",action:"poll",collection:"followup",teracJobId:row.id})}::jsonb)`,
      sql`INSERT INTO jobs (kind,payload,run_after) VALUES ('review',${JSON.stringify({purpose:"eval_round",action:"pause",collection:"followup",teracJobId:row.id})}::jsonb,${FOLLOWUP_STOP_AT}::timestamptz)`,
    ]);
    console.log(JSON.stringify({resumed:true,opportunityId:plan.id,startedAt,stopAt:FOLLOWUP_STOP_AT,additionalCostCents:0,submissionsUrl:resumed.submissionsUrl}));
  } catch (error) {
    await sql`UPDATE terac_jobs SET status='resume_unknown' WHERE id=${row.id} AND status='resuming'`;
    throw error;
  }
}

main().catch(error => { console.error("Follow-up resume stopped:",error instanceof Error ? error.message : "unknown error"); process.exitCode=1; });
