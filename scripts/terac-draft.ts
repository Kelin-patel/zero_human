import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { canonicalJson } from "../src/lib/case-generation";
import { getSql } from "../src/lib/db";
import { appendLedger } from "../src/lib/repo";
import { approveLaunch } from "../src/lib/governor";
import { balanceFromContext, draftAdjustment, parseOpportunity, PROJECT_ID, STOP_AT } from "../src/lib/terac-data";
import { assertTeracHost, runTerac } from "../src/lib/terac-headless";
import { DraftMcpClient } from "../src/lib/terac-mcp";

loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--direct-mcp") || args.length > 1) throw new Error("Usage: npm run terac:draft -- [--direct-mcp]");
  const direct = args.includes("--direct-mcp") ? new DraftMcpClient(process.env.TERAC_API_KEY || "") : null;
  if (!direct) assertTeracHost();
  const sql = getSql();
  const base = new URL(process.env.APP_BASE_URL || "");
  if (base.protocol !== "https:") throw new Error("APP_BASE_URL must be the HTTPS production URL.");
  const taskUrl = new URL("/task", base).toString();
  const existing = await sql`SELECT id, opportunity_id, status, meta FROM terac_jobs WHERE purpose = 'eval_round' AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`;
  if (existing.length) {
    const row = existing[0];
    console.log(`An evaluation draft already exists as terac_jobs #${row.id}, status=${row.status}. It will not be duplicated.`);
    if (!row.meta?.plan && row.opportunity_id && row.status === 'quoted') {
      // Reuse a teammate's already quoted draft; read-only MCP inspection does not alter it.
      if (direct) await direct.connect();
      const result = direct ? { response: { opportunity: await direct.call("terac_get_opportunity", { opportunityId: row.opportunity_id }), context: await direct.call("terac_get_context", {}) } }
        : await runTerac(`Read terac_get_context and terac_get_opportunity for opportunityId=${JSON.stringify(row.opportunity_id)}.
Return {"context": raw_context_response, "opportunity": raw_opportunity_response}. Do not create or change a draft.`, ["terac_get_context", "terac_get_opportunity"]);
      const parsed = parseOpportunity(result.response.opportunity);
      if (parsed.id !== row.opportunity_id || parsed.taskUrl !== taskUrl) throw new Error("Existing draft does not match the production task.");
      const balanceCents = balanceFromContext(result.response.context);
      const plan = { ...parsed, balanceCents, stopAt: STOP_AT, governor: approveLaunch(parsed, { affordable: parsed.affordable }, balanceCents) };
      await sql`UPDATE terac_jobs SET meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ plan })}::jsonb WHERE id = ${row.id} AND status = 'quoted'`;
      await appendLedger({ actor: "governor", decision: plan.governor.ok ? "ok" : "refuse", reason: plan.governor.reason,
        meta: { teracJobId: row.id, quote: { cpiCents: plan.cpiCents, n: plan.n, totalCents: plan.totalCents }, balanceCents } });
      console.log(canonicalJson({ teracJobId: row.id, ...plan }));
    } else if (row.meta?.plan) console.log(canonicalJson(row.meta.plan));
    return;
  }
  const requestId = randomUUID();
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS terac_eval_round_singleton ON terac_jobs (purpose) WHERE purpose = 'eval_round' AND status <> 'cancelled'`;
  const [job] = await sql`INSERT INTO terac_jobs (purpose, request_id, status, meta) VALUES ('eval_round', ${requestId}, 'drafting', ${JSON.stringify({ taskUrl })}::jsonb) RETURNING id`;
  let raw: unknown;
  try {
    const spec = { project_id: PROJECT_ID,
      title: "Review short refund disputes for an online course store (7 min)",
      description: "Read 8 short refund disputes for a fictional online course store and decide each one using the store's written policy. No special knowledge needed.",
      num_participants: 11, business_type: "b2c", unrestricted_audience: true, customer_screening_review: "auto_invite",
      tasks: [{ sequence: 1, task_type: "interview", review_type: "manual_review", task_url: taskUrl, duration_minutes: 7 }] };
    if (direct) await direct.connect();
    const created = direct ? await (async () => {
      const context = await direct.call("terac_get_context", {});
      const opportunity = await direct.call("terac_create_opportunity", spec);
      return { response: { context, opportunity }, estimatedCostUsd: 0 };
    })() : await runTerac(`Call terac_get_context, then create exactly ONE FREE DRAFT using terac_create_opportunity with these values: ${JSON.stringify(spec)}.
Use the base audience US, age 18+, any language. Add no screening questions or filters. Never launch or recruit.
Read it back with terac_get_opportunity. Return {"context": raw_get_context_response, "opportunity": raw_get_opportunity_response}.`,
      ["terac_get_context", "terac_create_opportunity", "terac_get_opportunity"]);
    raw = created.response;
    let plan = parseOpportunity(created.response.opportunity);
    const balanceCents = balanceFromContext(created.response.context);
    let headlessCostUsd = created.estimatedCostUsd;
    if (plan.taskUrl !== taskUrl) throw new Error("Draft task URL differs from production.");
    for (let adjustment = 0; adjustment < 3; adjustment++) {
      const next = draftAdjustment(plan, balanceCents);
      if (!next) break;
      const { n, durationMinutes: duration, reviewType } = next;
      const update = { opportunityId: plan.id, num_participants: n,
        title: `Review short refund disputes for an online course store (${duration} min)`,
        description: `Read ${duration === 5 ? 6 : 8} short refund disputes for a fictional online course store and decide each one using the store's written policy. No special knowledge needed.`,
        tasks: [{ sequence: 1, task_type: "interview", review_type: reviewType, task_url: taskUrl, duration_minutes: duration }] };
      const result = direct ? { response: { opportunity: await direct.call("terac_update_opportunity", update) }, estimatedCostUsd: 0 }
        : await runTerac(`Update only the existing FREE DRAFT ${JSON.stringify(plan.id)} in project ${PROJECT_ID}.
Set num_participants=${n}; task_type=interview, review_type=${reviewType}, task_url=${JSON.stringify(taskUrl)}, duration_minutes=${duration}.
Update the title and description to say ${duration} minutes and ${duration === 5 ? 6 : 8} short cards. Keep no screening questions or extra audience filters. Never launch.
Read it back and return {"opportunity": raw_get_opportunity_response}.`, ["terac_update_opportunity", "terac_get_opportunity"]);
      raw = { initial: raw, updated: result.response };
      headlessCostUsd += result.estimatedCostUsd;
      plan = parseOpportunity(result.response.opportunity);
      if (plan.taskUrl !== taskUrl || plan.n !== n || plan.durationMinutes !== duration || plan.reviewType !== reviewType) throw new Error("Terac did not confirm the requested free-draft adjustment.");
    }
    const finalApproval = approveLaunch(plan, { affordable: plan.affordable }, balanceCents);
    const savedPlan = { ...plan, balanceCents, stopAt: STOP_AT, governor: finalApproval };
    await sql`UPDATE terac_jobs SET opportunity_id = ${plan.id}, num_participants = ${plan.n}, quoted_cents_per_participant = ${plan.cpiCents},
      status = 'quoted', meta = ${JSON.stringify({ raw, plan: savedPlan, headlessCostUsd })}::jsonb WHERE id = ${job.id}`;
    await appendLedger({ actor: "governor", decision: finalApproval.ok ? "ok" : "refuse", reason: finalApproval.reason,
      meta: { teracJobId: job.id, quote: { cpiCents: plan.cpiCents, n: plan.n, totalCents: plan.totalCents }, balanceCents } });
    mkdirSync(".terac-local", { recursive: true });
    writeFileSync(".terac-local/draft-response.json", canonicalJson({ raw, plan: savedPlan, headlessCostUsd }));
    console.log(canonicalJson({ teracJobId: job.id, ...savedPlan }));
    console.log("Draft only. Share pricing, participant/card count and the completion URL with the reviewer-page owner before registration.");
  } catch (error) {
    await sql`UPDATE terac_jobs SET status = 'draft_unknown', meta = ${JSON.stringify({ raw, taskUrl })}::jsonb WHERE id = ${job.id}`;
    throw error;
  }
}
main().catch(error => { console.error("Terac draft stopped:", error instanceof Error ? error.message : "unknown error"); process.exitCode = 1; });
