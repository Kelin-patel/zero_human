import { getSql } from "./db";

export interface PublicLedgerEntry {
  id: number;
  created_at: string;
  actor: string;
  decision: string;
  reason: string;
  cost_cents: number | null;
  revenue_cents: number | null;
  env: string | null;
}

export async function readPublicLedger(): Promise<PublicLedgerEntry[]> {
  const sql = getSql();
  // Audit metadata can contain payment/customer identifiers and model inputs; keep it private.
  return await sql`SELECT id, created_at, actor, decision, reason, cost_cents, revenue_cents, env
    FROM ledger ORDER BY created_at DESC, id DESC LIMIT 100` as PublicLedgerEntry[];
}
