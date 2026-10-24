import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getOffer } from "@/lib/repo";

const OFFERS = [
  {
    sku: "pilot",
    name: "Pilot",
    blurb: "We connect your support agent (API or MCP tool), load your refund policy and limits, and include 2 independent human reviews.",
  },
  {
    sku: "review_pack",
    name: "Human Review Pack",
    blurb: "One more independent human review of an AI refund decision, with a second reviewer when needed.",
  },
];

const STEPS = [
  { title: "Your AI says no", text: "A customer is denied a refund by your support agent and asks for a second opinion." },
  {
    title: "A person reviews it",
    text: "A verified, independent reviewer applies your written policy to the evidence, with no stake in the outcome.",
  },
  {
    title: "The decision is carried out",
    text: "If the refund is due, it runs on Whop within the limits you set, and your AI learns from the ruling.",
  },
];

async function OfferButtons() {
  // Purchase links can change, so read them per request rather than at build time.
  await connection();
  const offers = await Promise.all(OFFERS.map((o) => getOffer(o.sku, "live").catch(() => null)));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {OFFERS.map((offer, i) => {
        const live = offers[i];
        return (
          <div key={offer.sku} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">{offer.name}</h3>
              {live && <span className="text-lg tabular-nums">${(live.price_cents / 100).toFixed(0)}</span>}
            </div>
            <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">{offer.blurb}</p>
            {live ? (
              <a
                href={live.purchase_url}
                className="rounded-lg bg-zinc-900 px-4 py-3 text-center font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Buy on Whop
              </a>
            ) : (
              <p className="text-sm text-zinc-500">Checkout is temporarily unavailable.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-14 px-4 py-16">
      <section className="flex flex-col gap-5">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Second Instance</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Independent human review, with the power to correct an AI decision.
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          When your support AI denies a refund, your customer can appeal to a real, independent person. If the
          person finds the refund is due under your own policy, it&apos;s paid out automatically.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/refund"
            className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Try the demo store (fictional)
          </Link>
          <a href="#pricing" className="rounded-lg border border-zinc-300 px-5 py-3 font-medium dark:border-zinc-700">
            Pricing
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
              <span className="text-sm text-zinc-500">Step {i + 1}</span>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="pricing" className="flex flex-col gap-6">
        <h2 className="text-xl font-semibold">Pricing</h2>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading checkout…</p>}>
          <OfferButtons />
        </Suspense>
      </section>

      <footer className="flex flex-col gap-2 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
        <p>
          Second Instance is operated by an AI agent. Refunds are funded by the merchant and executed within limits
          they set. Customers keep all their rights, including Whop&apos;s Resolution Center and their card issuer.
        </p>
      </footer>
    </main>
  );
}
