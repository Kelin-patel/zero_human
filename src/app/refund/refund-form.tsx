"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface OrderOption {
  id: string;
  product: string;
  priceUsd: number;
  summary: string;
  suggestedStatement: string;
}

export default function RefundForm({ orders, maxChars }: { orders: OrderOption[]; maxChars: number }) {
  const router = useRouter();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function pick(order: OrderOption) {
    setOrderId(order.id);
    setStatement(order.suggestedStatement);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!orderId) return setError("Pick an order first.");
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, statement }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
      router.push(body.statusUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">1. Your order</legend>
        {orders.map((order) => (
          <label
            key={order.id}
            className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-4 ${
              orderId === order.id
                ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <span className="flex items-start justify-between gap-4">
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="order"
                  value={order.id}
                  checked={orderId === order.id}
                  onChange={() => pick(order)}
                  className="h-4 w-4"
                />
                <span className="font-medium">{order.product}</span>
              </span>
              <span className="shrink-0 tabular-nums">${order.priceUsd.toFixed(2)}</span>
            </span>
            <span className="pl-7 text-sm text-zinc-600 dark:text-zinc-400">{order.summary}</span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="font-medium">2. What happened?</span>
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, maxChars))}
          rows={5}
          placeholder="Explain why you'd like a refund. Please don't include contact or card details."
          className="rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
        />
        <span className="self-end text-xs text-zinc-500 tabular-nums">
          {statement.length}/{maxChars}
        </span>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !orderId || statement.trim().length < 10}
        className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {submitting ? "Sending…" : "Request refund"}
      </button>
    </form>
  );
}
