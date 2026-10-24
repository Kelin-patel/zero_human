import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSql } from "@/lib/db";
import { getOffer } from "@/lib/repo";
import { CaseReplay } from "./_landing/case-replay";
import { decisionTone, humanize, TONE_BADGE } from "./ledger/tone";

const OFFERS = [
  {
    sku: "starter",
    name: "Starter check",
    price: 5,
    blurb:
      "One AI refund decision from your store re-checked by an independent agent against your policy and the evidence, with a written second opinion.",
  },
  {
    sku: "review_pack",
    name: "Human Review Pack",
    price: 15,
    blurb: "One more independent human review of an AI refund decision, with a second reviewer when needed.",
  },
  {
    sku: "pilot",
    name: "Pilot",
    price: 29,
    blurb: "We connect your support agent (API or MCP tool), load your refund policy and limits, and include 2 independent human reviews.",
  },
];

const RECOMMENDED_SKU = "review_pack";

const FACTS = [
  "Every decision cites the policy clause",
  "Refunds only within your limits",
  "Every action in a public ledger",
  "Evaluation pre-registered before any human label",
];

const STEPS = [
  {
    title: "Your AI says no",
    text: "A customer is denied a refund by your support agent, which cites the policy clause it relied on.",
  },
  {
    title: "The customer asks for review",
    text: "One click requests an independent second look. The original decision and its reasoning stay on file.",
  },
  {
    title: "Evidence is gathered",
    text: "A remote browser captures the product page and an excerpt of your published terms is attached to the case.",
  },
  {
    title: "Independent people review it",
    text: "Verified reviewers hired through Terac apply your written policy to the evidence, with no stake in the outcome.",
  },
  {
    title: "The decision is carried out",
    text: "If the refund is due, a separate executor issues it on Whop within the limits you set.",
  },
  {
    title: "Everything is on the record",
    text: "Each autonomous decision is written to a public ledger, and your AI learns from the ruling.",
  },
];

const GUARANTEES = [
  "Before paying, the executor re-checks the decision, the policy hash, per-case and daily limits, payment ownership and dispute status.",
  "Refunds are idempotent: a case can never be paid twice.",
  "Reviewers never see customer contact details.",
  "Customer text and web pages are treated as data, never as instructions.",
  "A budget governor keeps a $10 reserve before hiring people.",
];

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={`h-4 w-4 shrink-0 ${className}`}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionTitle({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <p className="kicker">{kicker}</p>
      <h2 className="font-display text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink sm:text-[40px]">
        {title}
      </h2>
      {children && <p className="text-base leading-relaxed text-ink-2 sm:text-[17px]">{children}</p>}
    </div>
  );
}

const ACTOR_LABELS: Record<string, string> = {
  governor: "Budget governor",
  orchestrator: "Review orchestrator",
  research_registry: "Evaluation registry",
  learner: "Learner",
  executor: "Refund executor",
  sales: "Sales",
  refund_desk: "Refund Desk",
};

const timeEt = (value: Date) =>
  value.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });

const clip = (text: string, max = 70) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The latest public ledger entries, scrolling under the hero. Renders nothing if the ledger is unreachable. */
async function LedgerTicker() {
  await connection();
  let rows: { id: string; actor: string; decision: string; reason: string; createdAt: Date }[];
  try {
    const sql = getSql();
    const result = await sql`SELECT id, actor, decision, reason, created_at FROM ledger ORDER BY id DESC LIMIT 14`;
    rows = result.map((r) => ({
      id: String(r.id),
      actor: ACTOR_LABELS[r.actor] ?? String(r.actor),
      decision: String(r.decision),
      reason: r.reason == null ? "" : String(r.reason),
      createdAt: new Date(r.created_at),
    }));
  } catch {
    return null;
  }
  if (rows.length === 0) return null;
  const items = [...rows, ...rows];
  return (
    <section className="border-t border-rule bg-card" aria-label="Live from the public ledger">
      <div className="container-page flex items-center gap-4 py-3">
        <Link href="/ledger" className="shrink-0 text-xs font-medium text-brand hover:underline hover:underline-offset-4">
          Live from the public ledger
        </Link>
        <div className="ticker min-w-0 flex-1">
          <ul className="anim-ticker flex w-max items-center gap-8">
            {items.map((row, i) => (
              <li key={`${row.id}-${i}`} aria-hidden={i >= rows.length} className="flex items-center gap-2 text-xs whitespace-nowrap">
                <span className="font-mono text-ink-3">{timeEt(row.createdAt)} ET</span>
                <span className="font-medium text-ink">{row.actor}</span>
                <span className={TONE_BADGE[decisionTone(row.decision)]}>{humanize(row.decision)}</span>
                {row.reason && <span className="text-ink-2">{clip(row.reason)}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function OfferCard({
  offer,
  live,
}: {
  offer: (typeof OFFERS)[number];
  live: Awaited<ReturnType<typeof getOffer>> | null;
}) {
  const recommended = offer.sku === RECOMMENDED_SKU;
  const price = live ? Math.round(live.price_cents / 100) : offer.price;
  return (
    <div className={`panel flex flex-col gap-5 p-6 ${recommended ? "border-ink" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{offer.name}</h3>
        {recommended && <span className="badge badge-neutral">Recommended</span>}
      </div>
      <p className="flex items-baseline gap-2">
        <span className="font-display text-[40px] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
          ${price}
        </span>
        <span className="text-sm text-ink-3">one-time</span>
      </p>
      <p className="flex-1 text-sm leading-relaxed text-ink-2">{offer.blurb}</p>
      {live ? (
        <a href={live.purchase_url} className={`${recommended ? "btn-primary" : "btn-secondary"} w-full`}>
          Buy on Whop
        </a>
      ) : (
        <p className="rounded-lg border border-rule bg-subtle px-4 py-2.5 text-center text-sm text-ink-3">
          Checkout is temporarily unavailable.
        </p>
      )}
    </div>
  );
}

async function OfferButtons() {
  // Purchase links can change, so read them per request rather than at build time.
  await connection();
  const offers = await Promise.all(OFFERS.map((o) => getOffer(o.sku, "live").catch(() => null)));
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {OFFERS.map((offer, i) => (
        <OfferCard key={offer.sku} offer={offer} live={offers[i]} />
      ))}
    </div>
  );
}

function OfferSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {OFFERS.map((offer) => (
        <div key={offer.sku} className="panel flex h-72 flex-col gap-3 p-6">
          <span className="font-display text-lg font-semibold tracking-tight text-ink">{offer.name}</span>
          <span className="text-sm text-ink-3">Loading checkout…</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="container-page flex flex-col gap-14">
          <div className="flex max-w-3xl flex-col gap-6">
            <p className="kicker">Independent review for AI refund decisions</p>
            <h1 className="font-display text-[44px] leading-[1.05] font-semibold tracking-[-0.02em] text-ink sm:text-[56px] lg:text-[64px]">
              When AI says no, your customers get a second look.
            </h1>
            <p className="max-w-2xl text-[17px] leading-relaxed text-ink-2">
              Second Instance gives customers independent human review of AI refund decisions, with the power to correct
              them, within the limits you set.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/refund" className="btn-primary">
                Try the demo
              </Link>
              <a href="#pricing" className="btn-secondary">
                View pricing
              </a>
            </div>
            <p className="text-sm text-ink-3">Operated by an AI agent · Payments by Whop · Reviewers via Terac</p>
          </div>
          <CaseReplay />
        </div>
      </section>

      <Suspense fallback={null}>
        <LedgerTicker />
      </Suspense>

      {/* Facts */}
      <section className="border-y border-rule bg-card">
        <ul className="container-page grid gap-x-8 gap-y-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact) => (
            <li key={fact} className="flex items-start gap-2.5 text-sm text-ink">
              <Check className="mt-0.5 text-ink" />
              {fact}
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section id="how" className="py-20 sm:py-28">
        <div className="container-page flex flex-col gap-12">
          <SectionTitle kicker="How it works" title="From a denial to a corrected decision.">
            Every appeal follows the same path, and every step leaves a record.
          </SectionTitle>
          <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 border-t border-rule pt-5">
                <span className="font-mono text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-lg font-semibold tracking-tight text-ink">{step.title}</h3>
                <p className="text-[15px] leading-relaxed text-ink-2">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Product */}
      <section id="product" className="border-y border-rule bg-subtle py-20 sm:py-28">
        <div className="container-page grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-6">
            <SectionTitle kicker="Product" title="Built for merchants who automate support">
              Your support AI keeps handling refunds. Second Instance adds an independent check on its denials, and a
              separate executor that can only pay out what your policy and your limits allow.
            </SectionTitle>
            <div className="flex flex-wrap gap-3">
              <Link href="/refund" className="btn-primary">
                Try the demo
              </Link>
              <Link href="/ledger" className="btn-secondary">
                Open the ledger
              </Link>
            </div>
            <p className="text-sm text-ink-3">The demo uses a fictional store. Sandbox transactions are labelled.</p>
          </div>
          <ul className="panel divide-y divide-rule">
            {GUARANTEES.map((g) => (
              <li key={g} className="flex items-start gap-3 px-5 py-4 text-[15px] leading-relaxed text-ink">
                <Check className="mt-1 text-ok" />
                {g}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Measured, not claimed */}
      <section id="measured" className="py-20 sm:py-28">
        <div className="container-page flex flex-col gap-10">
          <SectionTitle kicker="Evaluation" title="Measured, not claimed">
            We don&apos;t publish accuracy numbers we haven&apos;t earned.
          </SectionTitle>
          <div className="panel grid divide-y divide-rule md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="flex flex-col gap-2 p-6">
              <span className="badge badge-info w-fit">Pre-registered</span>
              <p className="text-[15px] leading-relaxed text-ink-2">
                The evaluation was pre-registered, with hashes committed before any human label existed.
              </p>
            </div>
            <div className="flex flex-col gap-2 p-6">
              <span className="badge badge-neutral w-fit">Baseline</span>
              <p className="text-[15px] leading-relaxed text-ink-2">
                The baseline decided <span className="font-mono text-ink">49</span> prepared cases.
              </p>
            </div>
            <div className="flex flex-col gap-2 p-6">
              <span className="badge badge-warn w-fit">No accuracy claim</span>
              <p className="text-[15px] leading-relaxed text-ink-2">
                The human panel had not completed by the registered cutoff, so no accuracy claim is made.
              </p>
            </div>
          </div>
          <p>
            <Link href="/ledger" className="link text-sm">
              Read the public ledger
            </Link>
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-rule py-20 sm:py-28">
        <div className="container-page flex flex-col gap-12">
          <SectionTitle kicker="Pricing" title="Start with one decision">
            Checkout runs on Whop. Refunds are funded by the merchant and executed within limits they set.
          </SectionTitle>
          <Suspense fallback={<OfferSkeleton />}>
            <OfferButtons />
          </Suspense>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-3">
            Second Instance is operated by an AI agent. Refunds are funded by the merchant and executed within limits
            they set. Customers keep all their rights, including Whop&apos;s Resolution Center and their card issuer.
          </p>
        </div>
      </section>

      {/* Closing band */}
      <section className="bg-ink text-white">
        <div className="container-page flex flex-col items-start gap-8 py-16 sm:py-20 md:flex-row md:items-center md:justify-between">
          <h2 className="max-w-xl font-display text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[36px]">
            See an AI decision get a second look.
          </h2>
          <Link
            href="/refund"
            className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-subtle"
          >
            Try the demo
          </Link>
        </div>
      </section>
    </>
  );
}
