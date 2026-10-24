"use client";

import { Fragment, useMemo, useState } from "react";
import { decisionTone, humanize, TONE_BADGE } from "./tone";

export type FeedRow = {
  id: number;
  actor: string;
  actorLabel: string;
  decision: string;
  reason: string;
  costCents: number;
  revenueCents: number;
  env: string;
  date: string;
  time: string;
  exact: string;
  ts: number;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`text-ink-3 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function Detail({ r }: { r: FeedRow }) {
  const facts: [string, string][] = [
    ["Timestamp", r.exact],
    ["Row id", `#${r.id}`],
    ["Cost", r.costCents > 0 ? money(r.costCents) : "none"],
    [r.env === "sandbox" ? "Sandbox amount (not revenue)" : "Revenue", r.revenueCents > 0 ? money(r.revenueCents) : "none"],
  ];
  return (
    <div className="anim-reveal flex flex-col gap-3 bg-subtle/60 px-4 py-4">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{r.reason || "No reason recorded."}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="font-mono text-[13px] tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function Actor({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink">
      <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-ink-3" aria-hidden />
      {label}
    </span>
  );
}

function Amount({ r }: { r: FeedRow }) {
  if (r.costCents <= 0 && r.revenueCents <= 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex flex-col items-end gap-0.5 font-mono text-[13px] tabular-nums">
      {r.costCents > 0 && <span className="text-ink-2">−{money(r.costCents)}</span>}
      {r.revenueCents > 0 &&
        (r.env === "sandbox" ? (
          <span className="text-xs text-ink-3">sandbox amount {money(r.revenueCents)} (not revenue)</span>
        ) : (
          <span className="text-ok">+{money(r.revenueCents)}</span>
        ))}
    </span>
  );
}

function Env({ env }: { env: string }) {
  if (env === "sandbox") return <span className="badge badge-warn">Sandbox / prepared</span>;
  if (!env) return <span className="text-ink-3">—</span>;
  return <span className="text-sm text-ink-2">{env === "live" ? "Live" : humanize(env)}</span>;
}

export function LedgerFeed({ rows }: { rows: FeedRow[] }) {
  const [actor, setActor] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  // Rows that arrive after a live refresh get a brief highlight.
  const [seen, setSeen] = useState<Set<number>>(() => new Set(rows.map((r) => r.id)));
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    const arrived = rows.filter((r) => !seen.has(r.id)).map((r) => r.id);
    setFresh(new Set(arrived));
    if (arrived.length > 0) setSeen(new Set([...seen, ...arrived]));
  }
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const actors = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const r of rows) {
      const entry = counts.get(r.actor) ?? { label: r.actorLabel, count: 0 };
      entry.count += 1;
      counts.set(r.actor, entry);
    }
    return [...counts.entries()];
  }, [rows]);

  const visible = actor ? rows.filter((r) => r.actor === actor) : rows;
  const seg = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
      active ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
      {actors.length > 1 && (
        <div className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-lg bg-subtle p-1" role="group" aria-label="Filter by actor">
          <button type="button" className={seg(actor === null)} onClick={() => setActor(null)} aria-pressed={actor === null}>
            All <span className="font-mono text-xs text-ink-3">{rows.length}</span>
          </button>
          {actors.map(([key, { label, count }]) => (
            <button
              key={key}
              type="button"
              className={seg(actor === key)}
              onClick={() => setActor(actor === key ? null : key)}
              aria-pressed={actor === key}
            >
              {label} <span className="font-mono text-xs text-ink-3">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Table from md up */}
      <div className="panel hidden overflow-hidden md:block">
        <table className="w-full table-fixed text-left">
          <thead className="bg-subtle text-xs font-medium text-ink-3">
            <tr>
              <th className="w-10 py-2.5 pl-3" aria-label="Details" />
              <th className="w-[7.5rem] px-4 py-2.5 font-medium">Time</th>
              <th className="w-[11rem] px-4 py-2.5 font-medium">Actor</th>
              <th className="px-4 py-2.5 font-medium">Event</th>
              <th className="w-[10rem] px-4 py-2.5 font-medium">Decision</th>
              <th className="w-[9rem] px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="w-[10rem] px-4 py-2.5 font-medium">Env</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isOpen = open.has(r.id);
              return (
              <Fragment key={r.id}>
              <tr
                className={`cursor-pointer border-t border-rule align-top transition-colors duration-150 hover:bg-subtle/60 ${fresh.has(r.id) ? "anim-flash" : ""}`}
                onClick={() => toggle(r.id)}
              >
                <td className="py-3 pl-3">
                  <button type="button" aria-expanded={isOpen} aria-label={`Details for entry ${r.id}`} className="rounded p-1 hover:bg-subtle">
                    <Chevron open={isOpen} />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-[13px] tabular-nums text-ink">{r.time}</div>
                  <div className="font-mono text-xs tabular-nums text-ink-3">{r.date} · #{r.id}</div>
                </td>
                <td className="px-4 py-3"><Actor label={r.actorLabel} /></td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-ink">{humanize(r.decision)}</div>
                  {r.reason && <p className="mt-0.5 line-clamp-2 break-words text-sm text-ink-2">{r.reason}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className={`${TONE_BADGE[decisionTone(r.decision)]} max-w-full overflow-hidden text-ellipsis font-mono`}>{r.decision}</span>
                </td>
                <td className="px-4 py-3 text-right"><Amount r={r} /></td>
                <td className="px-4 py-3"><Env env={r.env} /></td>
              </tr>
              {isOpen && (
                <tr className="border-t border-rule">
                  <td colSpan={7} className="p-0"><Detail r={r} /></td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stacked list below md */}
      <ol className="panel overflow-hidden md:hidden">
        {visible.map((r, i) => {
          const isOpen = open.has(r.id);
          return (
          <li key={r.id} className={`${i > 0 ? "border-t border-rule" : ""} ${fresh.has(r.id) ? "anim-flash" : ""}`}>
          <div className="flex cursor-pointer flex-col gap-2 px-4 py-3.5" onClick={() => toggle(r.id)}>
            <div className="flex items-center justify-between gap-3">
              <Actor label={r.actorLabel} />
              <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-ink-3">
                {r.date} {r.time}
                <button type="button" aria-expanded={isOpen} aria-label={`Details for entry ${r.id}`} className="rounded p-1">
                  <Chevron open={isOpen} />
                </button>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{humanize(r.decision)}</span>
              <span className={`${TONE_BADGE[decisionTone(r.decision)]} font-mono`}>{r.decision}</span>
              {r.env === "sandbox" && <Env env={r.env} />}
            </div>
            {r.reason && <p className="line-clamp-2 break-words text-sm text-ink-2">{r.reason}</p>}
            {(r.costCents > 0 || r.revenueCents > 0) && (
              <div className="flex justify-start [&>span]:items-start"><Amount r={r} /></div>
            )}
          </div>
          {isOpen && <Detail r={r} />}
          </li>
          );
        })}
      </ol>
    </div>
  );
}
