import { connection } from "next/server";
import { getSql } from "@/lib/db";

export async function GET() {
  await connection();
  try {
    const sql = getSql();
    const rows = await sql`SELECT * FROM ledger ORDER BY created_at DESC LIMIT 100`;
    return Response.json({ rows });
  } catch (err) {
    console.error("GET /api/ledger failed", err);
    return Response.json({ error: "Failed to load ledger" }, { status: 500 });
  }
}
