import { getSql } from "./db";

// Typed access to the tables shared by the app, the worker and the scripts.

export type JobKind = "provision" | "evidence" | "review" | "aggregate" | "execute" | "learn";
export type SetName = "dev" | "eval" | "gold" | "live" | "demo";
export type AgentVersion = "v1" | "v2";
export type DecisionValue = "approve" | "deny" | "out_of_scope";

// The fields this module reads from a case card. Cards carry more fields; all of them are stored.
export interface CaseCardShape {
  id: string;
  product?: string;
  price_usd?: number;
  purchased?: string;
  requested?: string;
  customer_statement?: string;
  store_position?: string;
  [field: string]: unknown;
}

export interface CaseRecord<Card extends CaseCardShape = CaseCardShape> {
  card: Card;
  set_name: SetName;
  hidden?: unknown;
  expected?: { decision: string } | null;
}

export interface CaseContext {
  merchantId?: string; // defaults to the demo store
  policyId?: number; // defaults to the merchant's latest policy version
  whopPaymentId?: string;
}

export interface StoredCase extends CaseRecord {
  merchantId: string | null;
  policyId: number | null;
  whopPaymentId: string | null;
  status: string;
  createdAt: string;
}

export interface DecisionRow {
  caseId: string;
  agentVersion: AgentVersion;
  decision: DecisionValue;
  clauses: string[];
  reason: string;
  votes?: unknown;
  dissent?: unknown;
  policySha256?: string;
  notesVersion?: string | null;
  meta?: unknown;
}

export interface JobRow {
  id: number;
  kind: JobKind;
  case_id: string | null;
  payload: unknown;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  run_after: string;
  last_error: string | null;
  created_at: string;
}

export interface LedgerEntry {
  actor: string;
  decision: string;
  reason: string;
  costCents?: number;
  revenueCents?: number;
  meta?: { env?: "live" | "sandbox"; [key: string]: unknown };
}

const MAX_JOB_ATTEMPTS = 5;
const RETRY_STEP_SECONDS = 30;

const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));

/** Inserts a case, or updates it in place when the id already exists. */
export async function createCase(c: CaseRecord, ctx: CaseContext = {}): Promise<void> {
  const sql = getSql();
  const card = c.card;
  const merchantId = ctx.merchantId ?? "demo";
  const amountCents = typeof card.price_usd === "number" ? Math.round(card.price_usd * 100) : null;
  await sql`
    INSERT INTO cases (id, merchant_id, policy_id, set_name, whop_payment_id, product, amount_cents,
                       purchased_at, requested_at, facts, customer_statement, merchant_statement, expected, hidden)
    VALUES (${card.id}, ${merchantId},
            COALESCE(${ctx.policyId ?? null}::int,
                     (SELECT id FROM policies WHERE merchant_id = ${merchantId} ORDER BY version DESC LIMIT 1)),
            ${c.set_name}, ${ctx.whopPaymentId ?? null}, ${card.product ?? null}, ${amountCents},
            ${card.purchased ?? null}::timestamptz, ${card.requested ?? null}::timestamptz, ${json(card)}::jsonb,
            ${card.customer_statement ?? null}, ${card.store_position ?? null},
            ${json(c.expected)}::jsonb, ${json(c.hidden)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      merchant_id = EXCLUDED.merchant_id, policy_id = EXCLUDED.policy_id, set_name = EXCLUDED.set_name,
      whop_payment_id = EXCLUDED.whop_payment_id, product = EXCLUDED.product,
      amount_cents = EXCLUDED.amount_cents, purchased_at = EXCLUDED.purchased_at,
      requested_at = EXCLUDED.requested_at, facts = EXCLUDED.facts,
      customer_statement = EXCLUDED.customer_statement, merchant_statement = EXCLUDED.merchant_statement,
      expected = EXCLUDED.expected, hidden = EXCLUDED.hidden`;
}

/** Returns the stored case. `card` is exactly what was saved; validate it with the case schema if needed. */
export async function getCase(id: string): Promise<StoredCase | null> {
  const sql = getSql();
  const [row] = await sql`SELECT * FROM cases WHERE id = ${id}`;
  if (!row) return null;
  return {
    card: row.facts as CaseCardShape,
    set_name: row.set_name as SetName,
    hidden: row.hidden ?? undefined,
    expected: row.expected ?? null,
    merchantId: row.merchant_id,
    policyId: row.policy_id,
    whopPaymentId: row.whop_payment_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

/**
 * Stores a decision. Returns false, and changes nothing, when the case already has a decision
 * for this agent version: recorded decisions are never overwritten.
 */
export async function insertDecision(d: DecisionRow): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO decisions (case_id, agent_version, decision, clauses, reason, votes, dissent,
                           policy_sha256, notes_version, meta)
    VALUES (${d.caseId}, ${d.agentVersion}, ${d.decision}, ${d.clauses}, ${d.reason}, ${json(d.votes)}::jsonb,
            ${json(d.dissent)}::jsonb, ${d.policySha256 ?? null}, ${d.notesVersion ?? null}, ${json(d.meta)}::jsonb)
    ON CONFLICT (case_id, agent_version) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/** Queues a job and returns its id. */
export async function enqueueJob(
  kind: JobKind,
  opts: { caseId?: string; payload?: unknown; runAfterSec?: number } = {},
): Promise<number> {
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO jobs (kind, case_id, payload, run_after)
    VALUES (${kind}, ${opts.caseId ?? null}, ${json(opts.payload)}::jsonb,
            now() + make_interval(secs => ${opts.runAfterSec ?? 0}))
    RETURNING id`;
  return row.id as number;
}

/**
 * Claims the oldest runnable job of the given kinds. One atomic statement with SKIP LOCKED,
 * so several workers can poll the same table without taking the same job.
 */
export async function claimNextJob(kinds: JobKind[]): Promise<JobRow | null> {
  if (kinds.length === 0) return null;
  const sql = getSql();
  const [row] = await sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = now()
    WHERE id = (SELECT id FROM jobs
                WHERE status = 'queued' AND run_after <= now() AND kind = ANY(${kinds})
                ORDER BY id
                FOR UPDATE SKIP LOCKED
                LIMIT 1)
    RETURNING *`;
  return (row as JobRow | undefined) ?? null;
}

export async function finishJob(id: number): Promise<void> {
  const sql = getSql();
  await sql`UPDATE jobs SET status = 'done', finished_at = now(), locked_at = NULL WHERE id = ${id}`;
}

/** Requeues a failed job with a linear backoff, or marks it failed after the last attempt. */
export async function failJob(id: number, error: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE jobs SET
      status = CASE WHEN attempts < ${MAX_JOB_ATTEMPTS} THEN 'queued' ELSE 'failed' END,
      run_after = CASE WHEN attempts < ${MAX_JOB_ATTEMPTS}
                       THEN now() + make_interval(secs => ${RETRY_STEP_SECONDS} * attempts)
                       ELSE run_after END,
      finished_at = CASE WHEN attempts < ${MAX_JOB_ATTEMPTS} THEN NULL ELSE now() END,
      last_error = left(${error}, 2000),
      locked_at = NULL
    WHERE id = ${id}`;
}

/** Appends one row to the public ledger. `meta.env` marks sandbox rows, which never count as revenue. */
export async function appendLedger(e: LedgerEntry): Promise<number> {
  const sql = getSql();
  const env = e.meta?.env === "sandbox" ? "sandbox" : "live";
  const [row] = await sql`
    INSERT INTO ledger (actor, decision, reason, cost_cents, revenue_cents, meta, env)
    VALUES (${e.actor}, ${e.decision}, ${e.reason}, ${e.costCents ?? null}, ${e.revenueCents ?? null},
            ${json(e.meta)}::jsonb, ${env})
    RETURNING id`;
  return row.id as number;
}
