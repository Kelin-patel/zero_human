import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSql } from "@/lib/db";
import { LedgerFeed, type FeedRow } from "./ledger-feed";
import { decisionTone, TONE_BADGE } from "./tone";

export const metadata: Metadata = {
  title: "Public ledger | Second Instance",
  description: "Every autonomous decision the agent makes, with its reason, cost and revenue.",
};

// The decisions that show the agent acting as an employer and operator, rather than the
// per-case Refund Desk rows, which are listed under "All entries".
const AGENT_ACTORS = ["governor", "orchestrator", "research_registry", "learner", "executor", "sales"];

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
  value.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateEt = (value: Date) =>
  value.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const money = (cents: number | null) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);

function Metric({ label, value, tone, note, index }: { label: string; value: string; tone?: string; note?: string; index: number }) {
  // 2x2 on phones, one row from sm up; hairline rules between cells.
  const rules = `${index % 2 === 1 ? "border-l" : index > 0 ? "sm:border-l" : ""} ${index >= 2 ? "border-t sm:border-t-0" : ""}`;
  return (
    <div className={`flex flex-col gap-1.5 border-rule p-4 sm:p-5 ${rules}`}>
      <span className="text-sm text-ink-3">{label}</span>
      <span className={`font-display text-[28px] font-semibold leading-none tracking-tight tabular-nums ${tone ?? "text-ink"}`}>{value}</span>
      {note && <span className="text-xs text-ink-3">{note}</span>}
    </div>
  );
}

async function Round() {
  await connection();
  const sql = getSql();
  const [row] = await sql`SELECT status, num_participants, quoted_cents_per_participant, meta->>'launchedAt' AS launched_at,
      meta->>'pausedAt' AS paused_at, meta->>'completedSubmissions' AS completed
    FROM terac_jobs WHERE purpose = 'eval_round' ORDER BY id DESC LIMIT 1`;
  if (!row) return null;
  const status = String(row.status);
  const tone = decisionTone(status);
  const fields: [string, string][] = [
    ["Reviewers bought", String(row.num_participants)],
    ["Price per reviewer", money(row.quoted_cents_per_participant)],
    ["Completed reviewers", row.completed ?? "0"],
    ["Launched", row.launched_at ? `${timeEt(new Date(row.launched_at))} ET` : "not yet"],
    ["Paused", row.paused_at ? `${timeEt(new Date(row.paused_at))} ET` : "not yet"],
  ];
  return (
    <section className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight text-ink">Human review round on Terac</h2>
          <p className="text-sm text-ink-3">The latest panel of people the agent paid to check its decisions.</p>
        </div>
        <span className={`${TONE_BADGE[tone]} font-mono`}>{status}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

async function Entries({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const all = view === "all";
  const sql = getSql();
  // Only public columns are read; metadata stays private.
  const rows = all
    ? await sql`SELECT id, actor, decision, reason, cost_cents, revenue_cents, env, created_at FROM ledger ORDER BY id DESC LIMIT 300`
    : await sql`SELECT id, actor, decision, reason, cost_cents, revenue_cents, env, created_at FROM ledger
        WHERE actor = ANY(${AGENT_ACTORS}) ORDER BY id ASC LIMIT 300`;

  const feed: FeedRow[] = rows.map((r) => {
    const at = new Date(r.created_at);
    return {
      id: Number(r.id),
      actor: String(r.actor),
      actorLabel: ACTOR_LABELS[r.actor] ?? String(r.actor),
      decision: String(r.decision),
      reason: r.reason == null ? "" : String(r.reason),
      costCents: Number(r.cost_cents ?? 0) || 0,
      revenueCents: Number(r.revenue_cents ?? 0) || 0,
      env: r.env == null ? "" : String(r.env),
      date: dateEt(at),
      time: timeEt(at),
    };
  });

  // Every figure below is summed from the rows on this page; nothing is estimated.
  const spend = feed.reduce((s, r) => s + r.costCents, 0);
  const liveRevenue = feed.filter((r) => r.env !== "sandbox").reduce((s, r) => s + r.revenueCents, 0);
  const sandboxAmount = feed.filter((r) => r.env === "sandbox").reduce((s, r) => s + r.revenueCents, 0);
  const executor = feed.filter((r) => r.actor === "executor");
  const executed = executor.filter((r) => decisionTone(r.decision) === "ok").length;
  const stopped = executor.filter((r) => decisionTone(r.decision) === "bad").length;

  const tab = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${active ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`;

  const metrics: { label: string; value: string; tone?: string; note?: string }[] = [
    { label: "Decisions", value: String(feed.length), note: all ? "All entries in view" : "Agent decisions in view" },
    { label: "Spend recorded", value: money(spend), note: "Sum of cost on these rows" },
    {
      label: "Live revenue",
      value: money(liveRevenue),
      note: sandboxAmount > 0 ? `Plus ${money(sandboxAmount)} sandbox, not revenue` : "Sandbox rows never count",
    },
  ];
  if (executor.length > 0) {
    metrics.push({ label: "Refunds executed / stopped", value: `${executed} / ${stopped}`, note: "Executor rows: executed vs blocked or failed" });
  }

  return (
    <section className="flex flex-col gap-6">
      <div className={`panel grid grid-cols-2 ${metrics.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {metrics.map((m, i) => (
          <Metric key={m.label} index={i} {...m} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="inline-flex gap-1 rounded-lg bg-subtle p-1">
          <Link href="/ledger" className={tab(!all)}>Agent decisions <span className="hidden text-ink-3 sm:inline">· oldest first</span></Link>
          <Link href="/ledger?view=all" className={tab(all)}>All entries <span className="hidden text-ink-3 sm:inline">· newest first</span></Link>
        </nav>
        <span className="text-xs text-ink-3">Times in ET · up to 300 rows</span>
      </div>

      {feed.length === 0 ? (
        <div className="panel px-6 py-12 text-center text-sm text-ink-3">No entries yet.</div>
      ) : (
        <LedgerFeed rows={feed} />
      )}
    </section>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="panel p-5 text-sm text-ink-3" aria-busy="true">
      {label}
    </div>
  );
}

export default function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  return (
    <div className="container-page flex flex-col gap-8 py-10 sm:py-14">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight text-ink">Public ledger</h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Every autonomous decision the agent makes is written here with its reason, cost and revenue: deciding refunds,
          buying human reviews within a budget, refusing or pausing, executing refunds and booking sales. Rows marked
          sandbox are prepared demo or evaluation activity and never count as revenue.
        </p>
        <p className="text-sm text-ink-3">Updated as the agent acts</p>
      </header>
      <Suspense fallback={<Skeleton label="Loading the review round…" />}>
        <Round />
      </Suspense>
      <Suspense fallback={<Skeleton label="Loading entries…" />}>
        <Entries searchParams={searchParams as Promise<{ view?: string }>} />
      </Suspense>
    </div>
  );
}
