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

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
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
    <form onSubmit={submit} className="panel flex flex-col">
      <fieldset className="flex min-w-0 flex-col gap-3 p-5 sm:p-6">
        <legend className="float-left mb-3 w-full text-sm font-medium text-ink">1. Choose an order</legend>
        {orders.map((order) => {
          const selected = orderId === order.id;
          return (
            <label
              key={order.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-[background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-sm focus-within:ring-2 focus-within:ring-brand/30 ${
                selected ? "border-ink bg-card ring-1 ring-ink" : "border-rule bg-card hover:bg-subtle"
              }`}
            >
              <input
                type="radio"
                name="order"
                value={order.id}
                checked={selected}
                onChange={() => pick(order)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                  selected ? "border-ink" : "border-rule-strong"
                }`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-ink" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-medium text-ink">{order.product}</span>
                <span className="text-sm leading-relaxed text-ink-2">{order.summary}</span>
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-ink">${order.priceUsd.toFixed(2)}</span>
            </label>
          );
        })}
      </fieldset>

      <label className="flex flex-col gap-2 border-t border-rule p-5 sm:p-6">
        <span className="text-sm font-medium text-ink">2. Tell us what happened</span>
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, maxChars))}
          rows={5}
          placeholder="Explain why you'd like a refund. Please don't include contact or card details."
          className="block w-full resize-y rounded-lg border border-rule-strong bg-card p-3 text-[15px] leading-relaxed text-ink transition-colors duration-150 placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <span className="flex items-center gap-3">
          <span aria-hidden className="h-[2px] flex-1 overflow-hidden rounded-full bg-rule">
            <span
              className={`block h-full transition-[width,background-color] duration-150 ${
                statement.length >= maxChars * 0.9 ? "bg-warn" : "bg-ink"
              }`}
              style={{ width: `${Math.min(100, (statement.length / maxChars) * 100)}%` }}
            />
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-3">
            {statement.length}/{maxChars}
          </span>
        </span>
      </label>

      {error && (
        <p role="alert" className="mx-5 mb-1 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad sm:mx-6">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-rule p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <p className="text-sm text-ink-3">An AI support desk decides first. You can ask for a human review.</p>
        <button
          type="submit"
          disabled={submitting || !orderId || statement.trim().length < 10}
          className="btn-primary justify-center disabled:cursor-not-allowed"
        >
          {submitting && <Spinner />}
          {submitting ? "Sending…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
