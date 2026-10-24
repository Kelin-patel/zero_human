import { appendLedger, saleRecorded, type JobRow } from "../../src/lib/repo";
import { moneyToCents, parseWhopEnv, whop } from "../../src/lib/whop";

// Books a sale for a verified `payment.succeeded` event. Amount and offer are re-read from Whop
// rather than trusted from the webhook body. Setting up the buyer's pilot comes later.
export async function provision(job: JobRow): Promise<void> {
  const { env: rawEnv, paymentId } = (job.payload ?? {}) as { env?: string; paymentId?: string };
  if (!paymentId) throw new Error(`provision job ${job.id} has no paymentId`);
  const env = parseWhopEnv(rawEnv);

  // A retried job must not book the same sale twice.
  if (await saleRecorded(paymentId)) return;

  const payment = await whop(env).payments.retrieve({ id: paymentId });
  if (payment.status !== "paid") throw new Error(`payment ${paymentId} is ${payment.status}, not paid yet`);

  const sku = typeof payment.metadata?.sku === "string" ? payment.metadata.sku : "unknown";
  const revenueCents = moneyToCents(payment.usd_total ?? payment.total);
  if (revenueCents === null) throw new Error(`payment ${paymentId} has no total`);

  await appendLedger({
    actor: "sales",
    decision: "sale",
    reason: sku,
    revenueCents,
    meta: { env, paymentId, sku, planId: payment.plan_id, productId: payment.product_id },
  });
  console.log(`provision: booked ${env} sale ${paymentId} (${sku}, ${revenueCents} cents)`);
}
