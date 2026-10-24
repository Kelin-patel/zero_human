import { getSql } from "@/lib/db";

// Whop expects a 2xx within 10s, so the insert is capped below that.
const INSERT_TIMEOUT_MS = 8000;

export async function POST(request: Request) {
  // Read the raw body exactly as sent; signature verification needs these bytes unmodified.
  const rawBody = await request.text();

  // TODO(security): verify the webhook signature before trusting anything in the payload.
  //   - Secret: process.env.WHOP_WEBHOOK_SECRET
  //   - Use Whop's SDK / docs (https://docs.whop.com) to verify `rawBody` against the
  //     signature headers on `request.headers`, and reject with 401 if it fails.
  //   - Until this is done the payload is UNVERIFIED: store it, but nothing downstream
  //     may grant access, credit the ledger, or otherwise act on it.

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody };
  }

  const eventType = getEventType(payload);

  try {
    const sql = getSql();
    await sql.query(
      "INSERT INTO webhook_events (source, event_type, payload) VALUES ($1, $2, $3::jsonb)",
      ["whop", eventType, JSON.stringify(payload)],
      { fetchOptions: { signal: AbortSignal.timeout(INSERT_TIMEOUT_MS) } },
    );
  } catch (err) {
    // Non-2xx so Whop redelivers instead of the event being lost.
    console.error("Whop webhook insert failed", err);
    return Response.json({ ok: false }, { status: 500 });
  }

  return Response.json({ ok: true });
}

// Whop event payloads name the event in `type` (newer) or `action` (older).
function getEventType(payload: unknown): string | null {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const value = p.type ?? p.action;
    if (typeof value === "string") return value;
  }
  return null;
}
