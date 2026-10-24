import { getSql } from "../src/lib/db";
import { appendLedger, setCaseStatus, type JobRow } from "../src/lib/repo";
import { moneyToCents, whop, whopAccountId, type WhopEnv } from "../src/lib/whop";

// The executor is the only module that ever issues a refund. It acts only on a final decision from
// independent human review and re-checks every limit itself, so no model output, reviewer page or
// webhook can move money on its own.

export interface ExecuteOptions {
  dryRun?: boolean;
}

export type ExecuteOutcome =
  | { status: "refunded"; env: WhopEnv; amountCents: number; paymentId: string; refundId: string | null }
  | { status: "blocked"; reason: string }
  | { status: "already_done"; executionStatus: string }
  | {
      status: "dry_run";
      env: WhopEnv;
      amountCents: number;
      call: { method: "payments.refund"; request: { id: string; metadata: Record<string, string> }; idempotencyKey: string };
    };

const SPENT_STATUSES = ["submitted", "succeeded"];

// Whop errors carry a readable message and code in their body; keep that, not the whole dump.
function describeWhopError(err: unknown): string {
  const body = (err as { body?: { error?: { code?: string; message?: string } } } | null)?.body?.error;
  if (body?.message) return body.code ? `${body.message} (${body.code})` : body.message;
  return err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : "unknown error";
}

export async function executeCase(caseId: string, opts: ExecuteOptions = {}): Promise<ExecuteOutcome> {
  const sql = getSql();
  const [c] = await sql`
    SELECT c.id, c.set_name, c.merchant_id, c.amount_cents, c.whop_payment_id, p.sha256 AS policy_sha256,
           m.mode, m.max_refund_cents, m.max_daily_refund_cents
    FROM cases c
    JOIN merchants m ON m.id = c.merchant_id
    LEFT JOIN policies p ON p.id = c.policy_id
    WHERE c.id = ${caseId}`;
  if (!c) throw new Error(`case ${caseId} not found`);

  // Demo cases and non-live merchants only ever touch the sandbox.
  const env: WhopEnv = c.set_name === "live" && c.mode === "live" ? "live" : "sandbox";
  const key = `exec_${caseId}_${c.policy_sha256 ?? "nopolicy"}`;

  const [previous] = await sql`SELECT status FROM executions WHERE case_id = ${caseId}`;
  if (previous && SPENT_STATUSES.includes(previous.status)) return { status: "already_done", executionStatus: previous.status };

  async function block(reason: string): Promise<ExecuteOutcome> {
    if (opts.dryRun) return { status: "blocked", reason };
    // A block can be re-evaluated later (for example once the human verdict arrives); a sent refund never can.
    await sql`
      INSERT INTO executions (case_id, idempotency_key, whop_payment_id, amount_cents, environment, status, block_reason, updated_at)
      VALUES (${caseId}, ${key}, ${c.whop_payment_id}, ${c.amount_cents}, ${env}, 'blocked', ${reason}, now())
      ON CONFLICT (case_id) DO UPDATE SET status = 'blocked', block_reason = EXCLUDED.block_reason, updated_at = now()
      WHERE executions.status IN ('blocked', 'failed')`;
    await appendLedger({ actor: "executor", decision: "block", reason, meta: { env, caseId } });
    return { status: "blocked", reason };
  }

  // Prepared evaluation cases are never refunded.
  if (c.set_name !== "demo" && c.set_name !== "live") return block("only customer requests can be refunded");

  const [final] = await sql`SELECT decision, reason FROM decisions WHERE case_id = ${caseId} AND agent_version = 'final'`;
  if (final?.decision !== "approve") return block("no approval from independent human review");

  const [current] = await sql`
    SELECT sha256 FROM policies WHERE merchant_id = ${c.merchant_id} ORDER BY version DESC LIMIT 1`;
  if (!c.policy_sha256 || c.policy_sha256 !== current?.sha256) return block("the policy changed after this case was decided");

  const amountCents = Number(c.amount_cents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return block("the case has no refundable amount");
  if (amountCents > c.max_refund_cents) return block("over the merchant's per-case refund limit");

  const [today] = await sql`
    SELECT COALESCE(SUM(e.amount_cents), 0)::int AS cents
    FROM executions e JOIN cases k ON k.id = e.case_id
    WHERE k.merchant_id = ${c.merchant_id} AND e.status = ANY(${SPENT_STATUSES})
      AND e.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')`;
  if (today.cents + amountCents > c.max_daily_refund_cents) return block("over the merchant's daily refund limit");

  const paymentId: string | null = c.whop_payment_id;
  if (!paymentId) return block("no Whop payment is linked to this case");
  const payment = await whop(env).payments.retrieve({ id: paymentId });
  if (payment.dispute_alerted_at) return block("the payment is disputed, and Whop forbids refunding it");
  if (payment.account_id !== whopAccountId(env) || payment.status !== "paid") {
    return block("the payment does not belong to this merchant or isn't paid");
  }
  if (moneyToCents(payment.usd_total ?? payment.total) !== amountCents) return block("the payment amount does not match the case");
  if ((moneyToCents(payment.refunded_amount) ?? 0) > 0 || !payment.refundable) {
    return block("Whop reports the payment as already refunded or not refundable");
  }

  const request = { id: paymentId, metadata: { case_id: caseId, idempotency_key: key } };
  if (opts.dryRun) {
    return { status: "dry_run", env, amountCents, call: { method: "payments.refund", request, idempotencyKey: key } };
  }

  // Claim the case before calling Whop, so two workers can never both send a refund for it.
  const claimed = await sql`
    INSERT INTO executions (case_id, idempotency_key, whop_payment_id, amount_cents, environment, status, updated_at)
    VALUES (${caseId}, ${key}, ${paymentId}, ${amountCents}, ${env}, 'submitted', now())
    ON CONFLICT (case_id) DO UPDATE SET status = 'submitted', block_reason = NULL, updated_at = now()
    WHERE executions.status IN ('blocked', 'failed')
    RETURNING id`;
  if (!claimed.length) return { status: "already_done", executionStatus: "submitted" };

  try {
    // Whop also de-duplicates on the idempotency key, so a retried call can't refund twice.
    const refunded = await whop(env).payments.refund(request, { idempotencyKey: key });
    const page = await whop(env).refunds.list({ payment_id: paymentId, first: 5 });
    const refunds = (page as unknown as { data?: { id: string; status: string; created_at: string }[] }).data ?? [];
    const refund = [...refunds].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    const succeeded = (moneyToCents(refunded.refunded_amount) ?? 0) >= amountCents || refund?.status === "succeeded";
    await sql`
      UPDATE executions SET status = ${succeeded ? "succeeded" : "submitted"}, whop_refund_id = ${refund?.id ?? null},
        meta = ${JSON.stringify({ refundStatus: refund?.status ?? null, refundedAmount: refunded.refunded_amount })}::jsonb,
        updated_at = now()
      WHERE case_id = ${caseId}`;
    await appendLedger({
      actor: "executor",
      decision: "refund",
      reason: final.reason || "approved by independent human review",
      costCents: amountCents,
      meta: { env, caseId, paymentId, refundId: refund?.id ?? null },
    });
    await setCaseStatus(caseId, "resolved");
    return { status: "refunded", env, amountCents, paymentId, refundId: refund?.id ?? null };
  } catch (err) {
    // For example, Whop refuses refunds the merchant's available balance can't cover yet. The job retries.
    const message = describeWhopError(err);
    await sql`UPDATE executions SET status = 'failed', block_reason = ${message}, updated_at = now() WHERE case_id = ${caseId}`;
    await appendLedger({ actor: "executor", decision: "refund_failed", reason: message, meta: { env, caseId, paymentId } });
    throw err;
  }
}

/** Worker handler for `execute` jobs. */
export async function execute(job: JobRow): Promise<void> {
  const caseId = job.case_id ?? (job.payload as { caseId?: string } | null)?.caseId;
  if (!caseId) throw new Error(`execute job ${job.id} has no case`);
  const outcome = await executeCase(caseId);
  console.log(`execute: ${caseId} -> ${outcome.status}${"reason" in outcome ? ` (${outcome.reason})` : ""}`);
}
