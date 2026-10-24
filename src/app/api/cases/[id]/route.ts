import { connection } from "next/server";
import { getCaseView } from "@/lib/repo";

/** Status of a customer or demo request: the decision, evidence, human reviews and the refund. */
export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]">) {
  await connection();
  const { id } = await ctx.params;
  try {
    const view = await getCaseView(id);
    if (!view) return Response.json({ error: "Request not found" }, { status: 404 });
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/cases/[id] failed", err);
    return Response.json({ error: "Failed to load the request" }, { status: 500 });
  }
}
