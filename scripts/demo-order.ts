import { randomBytes } from "node:crypto";
import { DEMO_ORDERS, buildDemoCard } from "../src/lib/demo-orders";
import { getSql } from "../src/lib/db";
import { createCase, enqueueJob } from "../src/lib/repo";
import { usableSandboxPayment } from "../src/lib/sandbox-payment";

// Creates a demo refund request backed by a real sandbox payment, so the AI decision, and for an
// approval the executor's sandbox refund, run end to end. The case is labelled as a sandbox demo.
//
// Usage, from the repo root:
//   npm run script -- scripts/demo-order.ts --order <order_id> --payment <sandbox pay_id> [--statement "..."]
//   Orders: spreadsheets (14-day refund), copywriting, photography (broken page), dashboards (certificate)

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the process environment.
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const order = DEMO_ORDERS.find((o) => o.id === value("--order"));
  const paymentId = value("--payment");
  if (!order || !paymentId) {
    throw new Error(
      `Usage: npm run script -- scripts/demo-order.ts --order <${DEMO_ORDERS.map((o) => o.id).join("|")}> --payment <pay_id>`,
    );
  }

  const amountCents = await usableSandboxPayment(paymentId);
  const caseId = `case_${randomBytes(9).toString("base64url")}`;
  const base = (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  // Priced at the sandbox payment it is linked to, so the executor's amount check matches.
  const card = { ...buildDemoCard(order, caseId, value("--statement") ?? order.suggestedStatement, base), price_usd: amountCents / 100 };
  await createCase({ card, set_name: "demo" }, { merchantId: "demo", whopPaymentId: paymentId });
  await getSql()`UPDATE cases SET public_note = 'Prepared demo · fictional store · sandbox payment' WHERE id = ${caseId}`;
  await enqueueJob("decide", { caseId });

  console.log(`created ${caseId} (${order.id}, $${(amountCents / 100).toFixed(2)}), linked to ${paymentId}`);
  console.log(`status page: ${base}/cases/${caseId}`);
  console.log("the worker decides it; an approval is then refunded in the sandbox by the executor");
}

main().catch((err) => {
  console.error("demo-order failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
