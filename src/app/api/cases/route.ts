import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DEMO_ORDERS, MAX_STATEMENT_CHARS, buildDemoCard } from "@/lib/demo-orders";
import { redactContactDetails } from "@/lib/redact";
import { countRecentCases, createCase, enqueueJob } from "@/lib/repo";

// Each request costs several model calls, so the public demo store is capped per hour.
const DEMO_CASES_PER_HOUR = 40;

const Body = z.object({
  orderId: z.string(),
  statement: z.string().trim().min(10).max(MAX_STATEMENT_CHARS),
});

/** Creates a refund request on the demo store and queues the Refund Desk decision. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `Write between 10 and ${MAX_STATEMENT_CHARS} characters.` }, { status: 400 });
  }
  const order = DEMO_ORDERS.find((o) => o.id === parsed.data.orderId);
  if (!order) return Response.json({ error: "Pick one of the demo orders." }, { status: 400 });

  try {
    if ((await countRecentCases("demo", 60)) >= DEMO_CASES_PER_HOUR) {
      return Response.json({ error: "The demo store is busy. Please try again in a few minutes." }, { status: 429 });
    }
    const id = `case_${randomBytes(9).toString("base64url")}`;
    const baseUrl = (process.env.APP_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
    const card = buildDemoCard(order, id, redactContactDetails(parsed.data.statement), baseUrl);
    await createCase({ card, set_name: "demo" }, { merchantId: "demo" });
    // Decisions take several model calls, longer than a serverless request may run, so the worker makes them.
    await enqueueJob("decide", { caseId: id });
    return Response.json({ id, statusUrl: `/cases/${id}` }, { status: 201 });
  } catch (err) {
    console.error("POST /api/cases failed", err);
    return Response.json({ error: "Could not create the request. Please try again." }, { status: 500 });
  }
}
