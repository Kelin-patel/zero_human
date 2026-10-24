import { getSql } from "./db";
import { moneyToCents, whop, whopAccountId } from "./whop";

/**
 * Checks that a sandbox payment can back a demo request: ours, paid, refundable and not linked to any
 * other case. Returns its amount in cents.
 */
export async function usableSandboxPayment(paymentId: string): Promise<number> {
  const payment = await whop("sandbox").payments.retrieve({ id: paymentId });
  if (payment.account_id !== whopAccountId("sandbox") || payment.status !== "paid" || !payment.refundable) {
    throw new Error(`${paymentId} is not a paid, refundable payment on our sandbox account`);
  }
  const linked = await getSql()`SELECT id FROM cases WHERE whop_payment_id = ${paymentId}`;
  if (linked.length) throw new Error(`${paymentId} is already linked to ${linked[0].id}`);
  const amountCents = moneyToCents(payment.usd_total ?? payment.total);
  if (!amountCents) throw new Error(`${paymentId} has no amount`);
  return amountCents;
}
