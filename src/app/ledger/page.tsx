import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getSql } from "@/lib/db";

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
const money = (cents: number | null) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);

async function Round() {
  await connection();
  const sql = getSql();
  const [row] = await sql`SELECT status, num_participants, quoted_cents_per_participant, meta->>'launchedAt' AS launched_at,
      meta->>'pausedAt' AS paused_at, meta->>'completedSubmissions' AS completed
    FROM terac_jobs WHERE purpose = 'eval_round' ORDER BY id DESC LIMIT 1`;
  if (!row) return null;
  const fields: [string, string][] = [
    ["Status", String(row.status)],
    ["Reviewers bought", String(row.num_participants)],
    ["Price per reviewer", money(row.quoted_cents_per_participant)],
    ["Launched", row.launched_at ? `${timeEt(new Date(row.launched_at))} ET` : "not yet"],
    ["Paused", row.paused_at ? `${timeEt(new Date(row.paused_at))} ET` : "not yet"],
    ["Completed reviewers", row.completed ?? "0"],
  ];
  return (
    <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="mb-3 font-semibold">Human review round on Terac</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-zinc-500">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
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
  const tab = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm ${active ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`;
  return (
    <section className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2">
        <Link href="/ledger" className={tab(!all)}>Agent decisions (oldest first)</Link>
        <Link href="/ledger?view=all" className={tab(all)}>All entries (newest first)</Link>
      </nav>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No entries yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-4">
              <div className="flex shrink-0 flex-row gap-3 text-sm sm:w-56 sm:flex-col sm:gap-0">
                <span className="tabular-nums text-zinc-500">{timeEt(new Date(r.created_at))} ET</span>
                <span className="font-medium">{ACTOR_LABELS[r.actor] ?? r.actor}</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-sm dark:bg-zinc-800">{r.decision}</span>
                  {r.env === "sandbox" && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">sandbox / prepared</span>
                  )}
                  {r.cost_cents > 0 && <span className="text-sm text-zinc-500">cost {money(r.cost_cents)}</span>}
                  {r.revenue_cents > 0 && (r.env === "sandbox"
                    ? <span className="text-sm text-zinc-500">sandbox amount {money(r.revenue_cents)} (not revenue)</span>
                    : <span className="text-sm text-emerald-700 dark:text-emerald-400">revenue {money(r.revenue_cents)}</span>)}
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">{r.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Second Instance</p>
        <h1 className="text-3xl font-semibold tracking-tight">Public ledger</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every autonomous decision the agent makes is written here with its reason, cost and revenue: deciding refunds,
          buying human reviews within a budget, refusing or pausing, executing refunds and booking sales. Rows marked
          sandbox are prepared demo or evaluation activity and never count as revenue.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading the review round…</p>}>
        <Round />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading entries…</p>}>
        <Entries searchParams={searchParams as Promise<{ view?: string }>} />
      </Suspense>
    </main>
  );
}
