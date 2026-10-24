import { connection } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    const sql = getSql();
    // Public feed: metadata (provider payloads, internal identifiers) is never exposed.
    const rows = await sql`SELECT id, actor, decision, reason, cost_cents, revenue_cents, env, created_at
      FROM ledger ORDER BY created_at DESC LIMIT 100`;
    return Response.json({ rows });
  } catch (err) {
    console.error("GET /api/ledger failed", err);
    return Response.json({ error: "Failed to load ledger" }, { status: 500 });
  }
}
