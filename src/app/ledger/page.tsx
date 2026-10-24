import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { readPublicLedger } from "@/lib/public-ledger";

const money = (cents: number | null) => cents === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

async function Entries() {
  await connection();
  const rows = await readPublicLedger().catch(() => null);
  if (rows === null) return <p role="status">The ledger is temporarily unavailable. Please refresh to try again.</p>;
  if (!rows.length) return <p>No actions have been recorded yet.</p>;
  return <ol className="flex flex-col gap-4">
    {rows.map(row => <li key={row.id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold break-words">{row.actor} · {row.decision}</p>
        <span className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">{row.env === "sandbox" ? "Sandbox · excluded from live revenue" : row.env === "live" ? "Live" : "Environment unrecorded"}</span>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{row.reason}</p>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-500">
        <div><dt className="inline">Cost: </dt><dd className="inline tabular-nums">{money(row.cost_cents)}</dd></div>
        <div><dt className="inline">Revenue: </dt><dd className="inline tabular-nums">{money(row.revenue_cents)}</dd></div>
        <div><dt className="sr-only">Recorded at</dt><dd><time dateTime={new Date(row.created_at).toISOString()}>{new Date(row.created_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></dd></div>
      </dl>
    </li>)}
  </ol>;
}

export default function Ledger() {
  return <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
    <Link href="/" className="text-sm underline">Second Instance</Link>
    <h1 className="text-3xl font-semibold">Agent activity ledger</h1>
    <p className="text-zinc-600 dark:text-zinc-400">The latest 100 recorded decisions, costs, receipts and refusals. Sandbox entries are labeled and never count as live revenue. A recorded attempt does not establish a completed review or refund.</p>
    <Suspense fallback={<p role="status">Loading recorded actions…</p>}><Entries /></Suspense>
  </main>;
}
