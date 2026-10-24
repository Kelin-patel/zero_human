import { loadEnvConfig } from "@next/env";
import { getSql } from "../src/lib/db";
import { approveLaunch } from "../src/lib/governor";
import { loadRegisteredReview } from "../src/lib/registration";
import { appendLedger } from "../src/lib/repo";
import { balanceFromContext, parseOpportunity, STOP_AT } from "../src/lib/terac-data";
import { runTerac } from "../src/lib/terac-headless";
import { DraftMcpClient } from "../src/lib/terac-mcp";

loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--check", "--direct-mcp"].includes(arg)) || new Set(args).size !== args.length ||
      (args.includes("--direct-mcp") && !args.includes("--check"))) throw new Error("Usage: npm run terac:launch -- [--check [--direct-mcp]]");
  // Fail before any MCP or database mutation if the public registration is missing or altered.
  const sql = getSql();
  const [row] = await sql`SELECT * FROM terac_jobs WHERE purpose = 'eval_round' ORDER BY id DESC LIMIT 1`;
  if (!row?.opportunity_id || !row.meta?.plan) throw new Error("Run the free draft script on the authenticated Terac host first.");
  const stored = row.meta.plan;
  const registration = loadRegisteredReview(stored.n, stored.cardsPerReviewer);
  if (Date.now() >= Date.parse(STOP_AT)) throw new Error("The registered recruitment stop time has passed; launch is blocked.");
  if (row.status === "launched" || row.status === "paused") { console.log(`Opportunity ${row.opportunity_id} is already ${row.status}; no new purchase.`); return; }
  if (row.status !== "quoted") throw new Error("A previous draft/launch outcome is unresolved. Inspect Terac before retrying; no duplicate launch will be attempted.");
  const direct = args.includes("--direct-mcp") ? new DraftMcpClient(process.env.TERAC_API_KEY || "") : null;
  if (direct) await direct.connect();
  const fresh = direct ? { response: { context: await direct.call("terac_get_context", {}), opportunity: await direct.call("terac_get_opportunity", { opportunityId: row.opportunity_id }) } }
    : await runTerac(`Read terac_get_context and terac_get_opportunity for opportunity_id=${JSON.stringify(row.opportunity_id)}.
Return {"context": raw_get_context_response, "opportunity": raw_get_opportunity_response}. Do not update or launch anything.`, ["terac_get_context", "terac_get_opportunity"]);
  const plan = parseOpportunity(fresh.response.opportunity);
  const balanceCents = balanceFromContext(fresh.response.context);
  if (plan.id !== row.opportunity_id || plan.n !== stored.n || plan.taskUrl !== stored.taskUrl ||
      plan.durationMinutes !== stored.durationMinutes || plan.reviewType !== stored.reviewType || plan.completionUrl !== stored.completionUrl) {
    throw new Error("Terac task parameters changed after the draft plan; re-register the actual design before launch.");
  }
  if (registration.round.cpiCents !== plan.cpiCents || registration.round.reviewType !== plan.reviewType ||
      plan.taskUrl !== new URL("/task", process.env.APP_BASE_URL).toString()) throw new Error("The quote or completion mode differs from the registered production task.");
  if (plan.reviewType === "auto_approve" && process.env.TERAC_COMPLETION_URL !== plan.completionUrl) throw new Error("Set the exact draft completion URL on the host and in Vercel, then redeploy before launch.");
  const [page, health] = await Promise.all([
    fetch(plan.taskUrl, { signal: AbortSignal.timeout(15000) }),
    fetch(new URL("/api/health", plan.taskUrl), { signal: AbortSignal.timeout(15000) }),
  ]);
  if (!page.ok || !health.ok) throw new Error("The production task or health endpoint is unavailable; launch is blocked.");
  if (!plan.completionUrl && plan.reviewType === "auto_approve") throw new Error("Automatic completion has no callback; the draft mode must be corrected before registration.");
  if (plan.reviewType !== "manual_review") throw new Error("This unscreened round requires registered manual_review with completion-based approvals.");
  const approval = approveLaunch(plan, { affordable: plan.affordable }, balanceCents);
  await appendLedger({ actor: "governor", decision: approval.ok ? "ok" : "refuse", reason: approval.reason,
    meta: { teracJobId: row.id, quote: { cpiCents: plan.cpiCents, n: plan.n, totalCents: plan.totalCents }, balanceCents, ...registration } });
  if (!approval.ok) throw new Error(approval.reason);
  if (args.includes("--check")) { console.log(JSON.stringify({ ready: true, ...approval, ...registration, quote: plan }, null, 2)); return; }
  const claimed = await sql`UPDATE terac_jobs SET status = 'launching' WHERE id = ${row.id} AND status = 'quoted' RETURNING id`;
  if (!claimed.length) throw new Error("Another process already claimed this launch.");
  let response;
  try {
    response = await runTerac(`Launch exactly ONCE the existing draft opportunityId=${JSON.stringify(plan.id)} using terac_launch_draft_opportunity with without_screener=true.
The validated funded total is ${plan.totalCents} cents for ${plan.n} participants; do not change the draft, its tasks or funding settings.
Then read terac_get_opportunity and return {"opportunity": raw_get_opportunity_response}.`, ["terac_launch_draft_opportunity", "terac_get_opportunity"]);
    const launched = parseOpportunity(response.response.opportunity);
    if (launched.id !== plan.id || !["launched", "active", "open", "recruiting", "published"].includes(String(launched.status)) ||
        launched.n !== plan.n || launched.totalCents !== plan.totalCents || launched.taskUrl !== plan.taskUrl || launched.reviewType !== plan.reviewType ||
        launched.durationMinutes !== plan.durationMinutes) throw new Error("Terac did not confirm the exact approved launch.");
    const delay = Math.max(1, Math.ceil((Date.parse(STOP_AT) - Date.now()) / 1000));
    const meta = { ...row.meta, plan: { ...plan, balanceCents, stopAt: STOP_AT }, ...registration, launchedAt: new Date().toISOString(), launchResponse: response.response };
    await sql.transaction([
      sql`UPDATE terac_jobs SET status = 'launched', meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${row.id} AND status = 'launching'`,
      sql`INSERT INTO ledger (actor, decision, reason, cost_cents, meta, env) VALUES ('orchestrator', 'buy_humans', 'Launch the registered independent review round', ${plan.totalCents},
        ${JSON.stringify({ teracJobId: row.id, opportunityId: plan.id, submissionsUrl: launched.submissionsUrl, ...registration })}::jsonb, 'live')`,
      sql`INSERT INTO jobs (kind, payload) VALUES ('review', ${JSON.stringify({ purpose: "eval_round", action: "poll", teracJobId: row.id })}::jsonb)`,
      sql`INSERT INTO jobs (kind, payload, run_after) VALUES ('review', ${JSON.stringify({ purpose: "eval_round", action: "pause", teracJobId: row.id })}::jsonb, now() + make_interval(secs => ${delay}))`,
    ]);
    console.log(JSON.stringify({ launched: true, opportunityId: plan.id, n: plan.n, totalCents: plan.totalCents, submissionsUrl: launched.submissionsUrl, stopAt: STOP_AT }, null, 2));
  } catch (error) {
    await sql`UPDATE terac_jobs SET status = 'launch_unknown', meta = meta || ${JSON.stringify({ launchResponse: response?.response ?? null })}::jsonb WHERE id = ${row.id} AND status = 'launching'`;
    throw error;
  }
}
main().catch(error => { console.error("Terac launch blocked:", error instanceof Error ? error.message : "unknown error"); process.exitCode = 1; });
