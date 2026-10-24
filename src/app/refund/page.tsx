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
    <div className="container-page py-10 sm:py-14">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <span>Example Academy (fictional) · Refund request</span>
            <span className="badge badge-warn whitespace-normal">Prepared demo · fictional store · no real money</span>
          </div>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight text-ink">
            Request a refund
          </h1>
          <p className="text-[15px] leading-relaxed text-ink-2">Pick one of your orders and tell us what happened.</p>
        </header>

        <RefundForm orders={orders} maxChars={MAX_STATEMENT_CHARS} />

        <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-2">
          <p>
            Our AI support desk decides under the store&apos;s written refund policy. If it says no, you can ask for
            an independent human review.
          </p>
          <p>
            <Link href="/" className="link">
              About Second Instance
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
