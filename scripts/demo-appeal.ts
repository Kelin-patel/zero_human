import { randomBytes } from "node:crypto";
import { CaseCard } from "../src/lib/case-schema";
import { getSql } from "../src/lib/db";
import { appendLedger, createCase, enqueueJob, getCase, insertDecision } from "../src/lib/repo";
import { moneyToCents, whop, whopAccountId } from "../src/lib/whop";

// Turns one prepared case that real reviewers decided against the AI into a demo request on the sandbox
// store, so the whole loop (AI denial -> human verdict -> refund) can be shown on a status page.
// It only creates demo records. Development labels can be read at any time; evaluation labels only once
// the review round is paused, so nothing here can influence the evaluation.
//
// Usage, from the repo root:
//   npm run script -- scripts/demo-appeal.ts --list
//   npm run script -- scripts/demo-appeal.ts --source <case_id> --payment <sandbox pay_id>

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the process environment.
}

const sql = getSql();

interface Candidate {
  caseId: string;
  setName: string;
  reviewers: { id: string; decision: string; reason: string }[];
}

async function roundPaused(): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM terac_jobs WHERE purpose = 'eval_round' AND status IN ('paused', 'completed') LIMIT 1`;
  return rows.length > 0;
}

/** Cases the AI denied in v1 and every counted reviewer approved. */
async function overturned(includeEval: boolean): Promise<Candidate[]> {
  const sets = includeEval ? ["dev", "eval"] : ["dev"];
  const rows = await sql`
    WITH failed_gold AS (
      SELECT DISTINCT terac_submission_id FROM reviews WHERE is_gold AND gold_passed = false
    )
    SELECT r.case_id, c.set_name, r.terac_submission_id, r.decision, r.reason
    FROM reviews r
    JOIN cases c ON c.id = r.case_id
    JOIN decisions d ON d.case_id = r.case_id AND d.agent_version = 'v1' AND d.decision = 'deny'
    WHERE NOT r.is_gold AND NOT r.is_test AND c.set_name = ANY(${sets})
      AND r.terac_submission_id NOT IN (SELECT terac_submission_id FROM failed_gold)
    ORDER BY r.case_id, r.id`;
  const byCase = new Map<string, Candidate>();
  for (const row of rows) {
    const entry: Candidate = byCase.get(row.case_id) ?? { caseId: row.case_id, setName: row.set_name, reviewers: [] };
    entry.reviewers.push({ id: row.terac_submission_id, decision: row.decision, reason: row.reason ?? "" });
    byCase.set(row.case_id, entry);
  }
  return [...byCase.values()].filter(
    (c) => c.reviewers.length >= (c.setName === "eval" ? 2 : 1) && c.reviewers.every((r) => r.decision === "approve"),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const paused = await roundPaused();

  if (args.includes("--list")) {
    const candidates = await overturned(paused);
    if (!paused) console.log("(evaluation cases are listed once the review round is paused)");
    if (!candidates.length) console.log("No case yet where every counted reviewer approved a v1 denial.");
    for (const c of candidates) console.log(`${c.caseId} (${c.setName}): ${c.reviewers.length} reviewer(s) approved`);
    return;
  }

  const sourceId = value("--source");
  const paymentId = value("--payment");
  if (!sourceId || !paymentId) {
    throw new Error("Usage: npm run script -- scripts/demo-appeal.ts --source <case_id> --payment <sandbox pay_id>");
  }

  const candidate = (await overturned(paused)).find((c) => c.caseId === sourceId);
  if (!candidate) {
    throw new Error(
      `${sourceId} is not a case where reviewers overturned a v1 denial` +
        (paused ? "" : " (evaluation cases are only available once the round is paused)"),
    );
  }

  // The refund comes out of a real sandbox payment that no other case uses.
  const payment = await whop("sandbox").payments.retrieve({ id: paymentId });
  if (payment.account_id !== whopAccountId("sandbox") || payment.status !== "paid" || !payment.refundable) {
    throw new Error(`${paymentId} is not a paid, refundable payment on our sandbox account`);
  }
  const linked = await sql`SELECT id FROM cases WHERE whop_payment_id = ${paymentId}`;
  if (linked.length) throw new Error(`${paymentId} is already linked to ${linked[0].id}`);
  const amountCents = moneyToCents(payment.usd_total ?? payment.total);
  if (!amountCents) throw new Error(`${paymentId} has no amount`);

  const source = await getCase(sourceId);
  const [v1] = await sql`SELECT * FROM decisions WHERE case_id = ${sourceId} AND agent_version = 'v1'`;
  if (!source || !v1) throw new Error(`${sourceId} has no stored card or v1 decision`);

  // Same facts as the reviewed case, priced at the sandbox payment it is linked to.
  const caseId = `case_${randomBytes(9).toString("base64url")}`;
  const card = { ...CaseCard.parse(source.card), id: caseId, price_usd: amountCents / 100 };
  const n = candidate.reviewers.length;
  const note = `Prepared case · reviewed by ${n === 1 ? "a real person" : `${n} real people`} in our Terac round · sandbox refund`;

  await createCase({ card, set_name: "demo" }, { merchantId: "demo", whopPaymentId: paymentId });
  await sql`UPDATE cases SET status = 'appealed', appealed_at = now(), public_note = ${note} WHERE id = ${caseId}`;
  await insertDecision({
    caseId,
    agentVersion: "live",
    decision: v1.decision,
    clauses: v1.clauses ?? [],
    reason: v1.reason ?? "",
    votes: v1.votes,
    dissent: v1.dissent,
    policySha256: v1.policy_sha256 ?? undefined,
    notesVersion: v1.notes_version,
    meta: { copiedFrom: sourceId },
  });
  await insertDecision({
    caseId,
    agentVersion: "final",
    decision: "approve",
    clauses: [],
    reason: `${n} of ${n} independent reviewer${n === 1 ? "" : "s"} approved this refund under the store's policy.`,
    votes: {
      sourceCase: sourceId,
      // Only a short prefix of each Terac submission ID is kept, enough to tell reviewers apart.
      reviewers: candidate.reviewers.map((r) => ({ reviewer: `${r.id.slice(0, 6)}…`, decision: r.decision, reason: r.reason })),
    },
  });
  await appendLedger({
    actor: "aggregator",
    decision: "approve",
    reason: "independent human review overturned the AI denial",
    meta: { env: "sandbox", caseId, sourceCase: sourceId, reviewers: n },
  });
  await enqueueJob("evidence", { caseId });
  await enqueueJob("execute", { caseId });

  const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  console.log(`created ${caseId} from ${sourceId} (${n} reviewer${n === 1 ? "" : "s"}), linked to ${paymentId}`);
  console.log(`status page: ${base}/cases/${caseId}`);
  console.log("evidence and execute jobs are queued for the worker");
}

main().catch((err) => {
  console.error("demo-appeal failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
