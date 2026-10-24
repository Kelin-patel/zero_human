import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getOffer } from "@/lib/repo";

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

type Dot = "ink" | "bad" | "warn" | "ok" | "info";

const DOT: Record<Dot, string> = {
  ink: "bg-ink-3",
  bad: "bg-bad",
  warn: "bg-warn",
  ok: "bg-ok",
  info: "bg-info",
};

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

function TimelineEvent({
  time,
  dot,
  title,
  last = false,
  children,
}: {
  time: string;
  dot: Dot;
  title: React.ReactNode;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[3.5px] w-px bg-rule" />}
      <span aria-hidden="true" className={`relative mt-[6px] h-2 w-2 shrink-0 rounded-full ${DOT[dot]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink">{title}</div>
          <span className="font-mono text-xs text-ink-3">{time}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

function CaseScreenshot() {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-subtle px-4 py-2.5">
        <span className="min-w-0 truncate text-xs text-ink-3">
          Case <span className="font-mono">case_7Hq2Lw</span> · Example Academy (fictional)
        </span>
        <span className="badge badge-neutral">Illustrative example</span>
      </div>
      <div className="grid md:grid-cols-[1fr_240px]">
        <ol className="p-5 sm:p-6">
          <TimelineEvent time="14:02" dot="ink" title={<span>Refund requested · <span className="font-mono">$59.00</span> · Intro to Product Photography</span>} />
          <TimelineEvent
            time="14:02"
            dot="bad"
            title={
              <>
                <span>AI support decision</span>
                <span className="badge badge-bad">Denied</span>
                <span className="text-xs text-ink-3">
                  cites <span className="font-mono">§4</span>
                </span>
              </>
            }
          />
          <TimelineEvent time="14:05" dot="ink" title="Customer requested independent review" />
          <TimelineEvent time="14:06" dot="info" title="Evidence attached: course page returned 404">
            <div className="flex h-[70px] w-[120px] flex-col items-center justify-center gap-1 rounded-md border border-rule bg-subtle">
              <span className="h-1 w-14 rounded-full bg-rule-strong" />
              <span className="font-mono text-[10px] text-ink-2">404 · Not Found</span>
            </div>
          </TimelineEvent>
          <TimelineEvent
            time="14:07"
            dot="warn"
            title={
              <>
                <span>Sent to 2 independent reviewers</span>
                <span className="badge badge-warn">In review</span>
              </>
            }
          />
          <TimelineEvent
            time="14:31"
            dot="ok"
            title={
              <>
                <span>Decision corrected</span>
                <span className="badge badge-ok">Refund approved</span>
              </>
            }
          />
          <TimelineEvent time="14:31" dot="ok" title="Refund issued via Whop" last>
            <span className="font-mono text-xs text-ink-3">re_4kP9…x2Tq</span>
          </TimelineEvent>
        </ol>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-rule bg-card p-5 text-sm sm:p-6 md:grid-cols-1 md:border-t-0 md:border-l">
          {[
            ["Order", <span key="o" className="font-mono text-xs">ord_2Ld8…</span>],
            ["Amount", <span key="a" className="font-mono">$59.00</span>],
            ["Store", "Example Academy (fictional)"],
            ["Policy", <span key="p" className="font-mono text-xs">v1 · 3f9a…</span>],
            ["Limit", "$100 per case"],
          ].map(([label, value]) => (
            <div key={label as string} className="flex flex-col gap-0.5">
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
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
          <CaseScreenshot />
        </div>
      </section>

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
