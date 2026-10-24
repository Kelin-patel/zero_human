import { unwrapWebhook, WebhookVerificationError } from "@whop/sdk/helpers";
import { recordWebhookEvent } from "@/lib/repo";
import { parseWhopEnv } from "@/lib/whop";

// Whop expects a 2xx in under 5s, so the insert is capped below that.
const INSERT_TIMEOUT_MS = 4000;

interface WhopEvent {
  type?: string;
  data?: { id?: string };
}

export async function POST(request: Request) {
  // Read the raw body exactly as sent; signature verification needs these bytes unmodified.
  const rawBody = await request.text();

  // The sandbox webhook is registered with ?env=sandbox, and each environment signs with its own secret.
  const env = parseWhopEnv(new URL(request.url).searchParams.get("env"));
  const key = env === "sandbox" ? process.env.WHOP_SANDBOX_WEBHOOK_SECRET : process.env.WHOP_WEBHOOK_SECRET;
  if (!key) {
    // Non-2xx so Whop keeps retrying until the secret is configured, instead of the event being lost.
    console.error(`Whop webhook secret for ${env} is not configured`);
    return Response.json({ ok: false }, { status: 500 });
  }

  let event: WhopEvent;
  try {
    // Checks the signature (the secret keeps its ws_ prefix) and rejects timestamps more than 5 minutes off.
    event = unwrapWebhook<WhopEvent>(rawBody, { headers: Object.fromEntries(request.headers), key });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return Response.json({ ok: false }, { status: 401 });
    throw err;
  }

  // Present on every verified delivery: the signature covers it, and retries reuse it.
  const webhookId = request.headers.get("webhook-id") as string;
  const eventType = typeof event.type === "string" ? event.type : null;
  const paymentId = eventType === "payment.succeeded" ? event.data?.id : undefined;

  try {
    const { duplicate } = await recordWebhookEvent({
      webhookId,
      env,
      eventType,
      payload: event,
      provision: paymentId ? { env, paymentId } : null,
      timeoutMs: INSERT_TIMEOUT_MS,
    });
    return Response.json({ ok: true, duplicate });
  } catch (err) {
    // Non-2xx so Whop redelivers instead of the event being lost.
    console.error("Whop webhook insert failed", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
