import { getSql } from "./db";

// Typed access to the tables shared by the app, the worker and the scripts.

export type JobKind = "provision" | "decide" | "evidence" | "review" | "aggregate" | "execute" | "learn";
export type SetName = "dev" | "eval" | "gold" | "live" | "demo";
// v1 and v2 are the frozen evaluation runs; live decides customer and demo requests;
// final is the outcome of independent human review, the only decision the executor acts on.
export type AgentVersion = "v1" | "v2" | "live" | "final";
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
// The driver returns timestamps as Date objects; views expose plain ISO strings.
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value));

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

export async function getPolicy(id: number): Promise<{ id: number; text: string; sha256: string } | null> {
  const sql = getSql();
  const [row] = await sql`SELECT id, text, sha256 FROM policies WHERE id = ${id}`;
  return row ? { id: row.id, text: row.text, sha256: row.sha256 } : null;
}

export async function hasDecision(caseId: string, agentVersion: AgentVersion): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`SELECT 1 FROM decisions WHERE case_id = ${caseId} AND agent_version = ${agentVersion}`;
  return rows.length > 0;
}

export async function setCaseStatus(id: string, status: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE cases SET status = ${status} WHERE id = ${id}`;
}

/** Number of cases of one set created in the last `minutes` minutes. */
export async function countRecentCases(setName: SetName, minutes: number): Promise<number> {
  const sql = getSql();
  const [row] = await sql`
    SELECT count(*)::int AS n FROM cases
    WHERE set_name = ${setName} AND created_at > now() - make_interval(mins => ${minutes})`;
  return row.n as number;
}

// Only customer-facing cases are visible on status pages; prepared evaluation cases and their labels never are.
const PUBLIC_SETS = ["demo", "live"];

/**
 * Accepts an appeal only for a public case whose live decision is a denial and that hasn't been appealed
 * yet, then queues evidence gathering and the human review in the same statement. Returns false otherwise.
 */
export async function requestAppeal(id: string, statement: string | null): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    WITH c AS (
      UPDATE cases SET status = 'appealed', appeal_statement = ${statement}, appealed_at = now()
      WHERE id = ${id} AND status = 'decided' AND set_name = ANY(${PUBLIC_SETS})
        AND EXISTS (SELECT 1 FROM decisions d
                    WHERE d.case_id = ${id} AND d.agent_version = 'live' AND d.decision = 'deny')
      RETURNING id
    ), evidence_job AS (
      INSERT INTO jobs (kind, case_id) SELECT 'evidence', id FROM c RETURNING id
    ), review_job AS (
      INSERT INTO jobs (kind, case_id, run_after) SELECT 'review', id, now() + interval '30 seconds' FROM c RETURNING id
    )
    SELECT (SELECT id FROM c) AS case_id`;
  return rows[0]?.case_id != null;
}

export interface CaseView {
  id: string;
  setName: SetName;
  status: string;
  product: string | null;
  amountCents: number | null;
  purchasedAt: string | null;
  requestedAt: string | null;
  customerStatement: string | null;
  appealStatement: string | null;
  appealedAt: string | null;
  createdAt: string;
  publicNote: string | null;
  decision: { decision: DecisionValue; clauses: string[]; reason: string; decidedAt: string } | null;
  humanVerdict: {
    decision: DecisionValue;
    reason: string;
    reviewers: { reviewer: string; decision: string; reason: string }[];
    decidedAt: string;
  } | null;
  evidence: {
    kind: string;
    summary: string | null;
    url: string | null;
    httpStatus: number | null;
    screenshotUrl: string | null;
    capturedAt: string;
  }[];
  reviews: { decision: string; reason: string | null; createdAt: string }[];
  execution: {
    status: string;
    amountCents: number | null;
    environment: string | null;
    blockReason: string | null;
    whopRefundId: string | null;
    createdAt: string;
  } | null;
}

/** Everything the customer status page shows. Null for unknown ids and for non-public cases. */
export async function getCaseView(id: string): Promise<CaseView | null> {
  const sql = getSql();
  const [c] = await sql`SELECT * FROM cases WHERE id = ${id} AND set_name = ANY(${PUBLIC_SETS})`;
  if (!c) return null;
  const [decisionRows, evidenceRows, reviewRows, executionRows] = await Promise.all([
    sql`SELECT agent_version, decision, clauses, reason, votes, created_at FROM decisions
        WHERE case_id = ${id} AND agent_version IN ('live', 'final')`,
    sql`SELECT kind, summary, url, http_status, screenshot_url, captured_at FROM evidence WHERE case_id = ${id} ORDER BY id`,
    sql`SELECT decision, reason, created_at FROM reviews WHERE case_id = ${id} AND NOT is_gold ORDER BY id`,
    sql`SELECT status, amount_cents, environment, block_reason, whop_refund_id, created_at FROM executions
        WHERE case_id = ${id}`,
  ]);
  const d = decisionRows.find((row) => row.agent_version === "live");
  const f = decisionRows.find((row) => row.agent_version === "final");
  const x = executionRows[0];
  return {
    id: c.id,
    setName: c.set_name,
    status: c.status,
    product: c.product,
    amountCents: c.amount_cents,
    purchasedAt: iso(c.purchased_at),
    requestedAt: iso(c.requested_at),
    customerStatement: c.customer_statement,
    appealStatement: c.appeal_statement,
    appealedAt: iso(c.appealed_at),
    createdAt: iso(c.created_at) as string,
    publicNote: c.public_note ?? null,
    decision: d ? { decision: d.decision, clauses: d.clauses ?? [], reason: d.reason ?? "", decidedAt: iso(d.created_at) as string } : null,
    humanVerdict: f
      ? {
          decision: f.decision,
          reason: f.reason ?? "",
          reviewers: (f.votes?.reviewers ?? []) as { reviewer: string; decision: string; reason: string }[],
          decidedAt: iso(f.created_at) as string,
        }
      : null,
    evidence: evidenceRows.map((e) => ({
      kind: e.kind,
      summary: e.summary,
      url: e.url,
      httpStatus: e.http_status,
      screenshotUrl: e.screenshot_url,
      capturedAt: iso(e.captured_at) as string,
    })),
    reviews: reviewRows.map((r) => ({ decision: r.decision, reason: r.reason, createdAt: iso(r.created_at) as string })),
    execution: x
      ? {
          status: x.status,
          amountCents: x.amount_cents,
          environment: x.environment,
          blockReason: x.block_reason,
          whopRefundId: x.whop_refund_id,
          createdAt: iso(x.created_at) as string,
        }
      : null,
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

export interface WebhookEventInput {
  webhookId: string;
  env: "live" | "sandbox";
  eventType: string | null;
  payload: unknown;
  provision?: { env: "live" | "sandbox"; paymentId: string } | null;
  timeoutMs?: number;
}

/**
 * Stores a verified webhook event once per `webhook-id` and, for a new payment, queues its
 * `provision` job in the same statement. Whop retries reuse the same id, so a redelivery is a
 * no-op, and a stored event can never be missing its job.
 */
export async function recordWebhookEvent(e: WebhookEventInput): Promise<{ duplicate: boolean; jobId: number | null }> {
  const sql = getSql();
  const rows = await sql.query(
    `WITH ev AS (
       INSERT INTO webhook_events (source, event_type, payload, webhook_id, env, verified)
       VALUES ('whop', $1, $2::jsonb, $3, $4, true)
       ON CONFLICT (webhook_id) DO NOTHING
       RETURNING id
     ), job AS (
       INSERT INTO jobs (kind, payload)
       SELECT 'provision', $5::jsonb FROM ev WHERE $5::jsonb IS NOT NULL
       RETURNING id
     )
     SELECT (SELECT id FROM ev) AS event_id, (SELECT id FROM job) AS job_id`,
    [e.eventType, json(e.payload), e.webhookId, e.env, json(e.provision ?? undefined)],
    e.timeoutMs ? { fetchOptions: { signal: AbortSignal.timeout(e.timeoutMs) } } : undefined,
  );
  const row = rows[0] ?? {};
  return { duplicate: row.event_id == null, jobId: (row.job_id as number | null) ?? null };
}

export interface OfferRow {
  sku: string;
  env: "live" | "sandbox";
  checkout_config_id: string;
  purchase_url: string;
  price_cents: number;
}

export async function getOffer(sku: string, env: "live" | "sandbox"): Promise<OfferRow | null> {
  const sql = getSql();
  const [row] = await sql`SELECT * FROM offers WHERE sku = ${sku} AND env = ${env}`;
  return (row as OfferRow | undefined) ?? null;
}

export async function upsertOffer(o: OfferRow): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO offers (sku, env, checkout_config_id, purchase_url, price_cents)
    VALUES (${o.sku}, ${o.env}, ${o.checkout_config_id}, ${o.purchase_url}, ${o.price_cents})
    ON CONFLICT (sku, env) DO UPDATE SET
      checkout_config_id = EXCLUDED.checkout_config_id, purchase_url = EXCLUDED.purchase_url,
      price_cents = EXCLUDED.price_cents, created_at = now()`;
}

/** True when the ledger already has a sale for this Whop payment. */
export async function saleRecorded(paymentId: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM ledger WHERE actor = 'sales' AND decision = 'sale' AND meta->>'paymentId' = ${paymentId} LIMIT 1`;
  return rows.length > 0;
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
