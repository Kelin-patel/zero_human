import type { Metadata } from "next";
import Link from "next/link";
import { DEMO_ORDERS, MAX_STATEMENT_CHARS } from "@/lib/demo-orders";
import RefundForm from "./refund-form";

export const metadata: Metadata = {
  title: "Request a refund · Example Academy (fictional)",
};

export default function RefundPage() {
  const orders = DEMO_ORDERS.map(({ id, product, priceUsd, summary, suggestedStatement }) => ({
    id,
    product,
    priceUsd,
    summary,
    suggestedStatement,
  }));
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <p className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Prepared demo · fictional store · no real money
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Example Academy: request a refund</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Pick one of your orders and tell us what happened. Our AI support desk decides under the store&apos;s
          written refund policy. If it says no, you can ask for an independent human review.
        </p>
      </div>
      <RefundForm orders={orders} maxChars={MAX_STATEMENT_CHARS} />
      <p className="text-sm text-zinc-500">
        <Link href="/" className="underline">
          About Second Instance
        </Link>
      </p>
    </main>
  );
}
