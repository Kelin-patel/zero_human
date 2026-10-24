import { getSql } from "@/lib/db";

/** Serves an evidence screenshot, only for cases the public status page may show. */
export async function GET(_request: Request, ctx: RouteContext<"/api/evidence/[id]/screenshot">) {
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/u.test(id)) return new Response("Not found", { status: 404 });
  try {
    const sql = getSql();
    const [row] = await sql`SELECT e.raw->'screenshot'->>'base64' AS base64 FROM evidence e JOIN cases c ON c.id = e.case_id
      WHERE e.id = ${Number(id)} AND c.set_name IN ('demo', 'live')`;
    if (!row?.base64) return new Response("Not found", { status: 404 });
    // The stored type is never trusted: screenshots are always captured as JPEG.
    return new Response(Buffer.from(row.base64, "base64"), {
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
    });
  } catch (err) {
    console.error("GET /api/evidence/[id]/screenshot failed", err);
    return new Response("Unavailable", { status: 500 });
  }
}
