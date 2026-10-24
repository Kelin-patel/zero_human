import { z } from "zod";
import { MAX_STATEMENT_CHARS } from "@/lib/demo-orders";
import { redactContactDetails } from "@/lib/redact";
import { requestAppeal } from "@/lib/repo";

const Body = z.object({ statement: z.string().trim().max(MAX_STATEMENT_CHARS).optional() });

/** The customer asks for independent human review of a denied request. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/appeal">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: `Keep the note under ${MAX_STATEMENT_CHARS} characters.` }, { status: 400 });
  }
  try {
    const note = parsed.data.statement ? redactContactDetails(parsed.data.statement) : null;
    const accepted = await requestAppeal(id, note || null);
    if (!accepted) {
      return Response.json(
        { error: "Only a denied request can be sent for human review, and only once." },
        { status: 409 },
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("POST /api/cases/[id]/appeal failed", err);
    return Response.json({ error: "Could not request the review. Please try again." }, { status: 500 });
  }
}
