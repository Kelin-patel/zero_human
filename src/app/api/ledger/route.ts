import { connection } from "next/server";
import { readPublicLedger } from "@/lib/public-ledger";

export async function GET() {
  await connection();
  try {
    const rows = await readPublicLedger();
    return Response.json({ rows });
  } catch (err) {
    console.error("GET /api/ledger failed", err instanceof Error ? err.name : "unknown failure");
    return Response.json({ error: "Failed to load ledger" }, { status: 500 });
  }
}
