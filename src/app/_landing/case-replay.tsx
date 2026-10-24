"use client";

import { useEffect, useState, type ReactNode } from "react";

type Dot = "ink" | "bad" | "warn" | "ok" | "info";

const DOT: Record<Dot, string> = {
  ink: "bg-ink-3",
  bad: "bg-bad",
  warn: "bg-warn",
  ok: "bg-ok",
  info: "bg-info",
};

const DENIED_STEP = 1;
const CORRECTED_STEP = 5;

const EVENTS: { time: string; dot: Dot; title: ReactNode; extra?: ReactNode }[] = [
  {
    time: "14:02",
    dot: "ink",
    title: (
      <span>
        Refund requested · <span className="font-mono">$59.00</span> · Intro to Product Photography
      </span>
    ),
  },
  {
    time: "14:02",
    dot: "bad",
    title: (
      <>
        <span>AI support decision</span>
        <span className="badge badge-bad">Denied</span>
        <span className="text-xs text-ink-3">
          cites <span className="font-mono">§4</span>
        </span>
      </>
    ),
  },
  { time: "14:05", dot: "ink", title: "Customer requested independent review" },
  {
    time: "14:06",
    dot: "info",
    title: "Evidence attached: course page returned 404",
    extra: (
      <span className="flex h-[70px] w-[120px] flex-col items-center justify-center gap-1 rounded-md border border-rule bg-subtle">
        <span className="h-1 w-14 rounded-full bg-rule-strong" />
        <span className="font-mono text-[10px] text-ink-2">404 · Not Found</span>
      </span>
    ),
  },
  {
    time: "14:07",
    dot: "warn",
    title: (
      <>
        <span>Sent to 2 independent reviewers</span>
        <span className="badge badge-warn">In review</span>
      </>
    ),
  },
  {
    time: "14:31",
    dot: "ok",
    title: (
      <>
        <span>Decision corrected</span>
        <span className="badge badge-ok">Refund approved</span>
      </>
    ),
  },
  {
    time: "14:31",
    dot: "ok",
    title: "Refund issued via Whop",
    extra: <span className="font-mono text-xs text-ink-3">re_4kP9…x2Tq</span>,
  },
];

const DETAILS: [string, ReactNode][] = [
  ["Order", <span key="o" className="font-mono text-xs">ord_2Ld8…</span>],
  ["Amount", <span key="a" className="font-mono">$59.00</span>],
  ["Store", "Example Academy (fictional)"],
  ["Policy", <span key="p" className="font-mono text-xs">v1 · 3f9a…</span>],
  ["Limit", "$100 per case"],
];

/** An illustrative case replayed event by event: the AI denial, then the human correction. */
export function CaseReplay() {
  const [shown, setShown] = useState(0);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!auto || shown >= EVENTS.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), shown === 0 ? 350 : 650);
    return () => clearTimeout(t);
  }, [auto, shown]);

  const replay = () => {
    setShown(0);
    setAuto(true);
  };

  const jump = (i: number) => {
    setAuto(false);
    setShown(i + 1);
  };

  const denied = shown > DENIED_STEP;
  const overturned = shown > CORRECTED_STEP;

  return (
    <div className="panel relative overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-subtle px-4 py-2">
        <span className="min-w-0 truncate text-xs text-ink-3">
          Case <span className="font-mono">case_7Hq2Lw</span> · Example Academy (fictional)
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="badge badge-neutral">Illustrative example</span>
          <button type="button" onClick={replay} className="btn-secondary h-8 px-3 text-xs">
            Replay
          </button>
        </div>
      </div>

      <div className="relative grid md:grid-cols-[1fr_240px]">
        {/* Verdict stamps */}
        <div className="pointer-events-none absolute top-4 right-4 z-10 md:right-[264px]" aria-live="polite">
          {denied && (
            <span className={`stamp anim-stamp text-bad ${overturned ? "struck opacity-40" : ""}`}>Denied</span>
          )}
          {overturned && (
            <span
              className="stamp anim-stamp absolute top-3 right-2 bg-card/90 text-ok"
              style={{ transform: "rotate(-3deg)", animationName: "stamp-in-3" }}
            >
              Overturned
            </span>
          )}
        </div>

        <ol className="p-5 sm:p-6">
          {EVENTS.map((ev, i) => {
            const visible = i < shown;
            const last = i === EVENTS.length - 1;
            return (
              <li key={i} className={`relative pb-5 last:pb-0 ${visible ? "anim-reveal" : "opacity-25"}`}>
                {!last && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[3.5px] w-px bg-rule" />}
                <button
                  type="button"
                  onClick={() => jump(i)}
                  className="group relative flex w-full gap-3 rounded-md text-left"
                  aria-label={`Jump to step ${i + 1}`}
                >
                  <span aria-hidden="true" className={`relative mt-[6px] h-2 w-2 shrink-0 rounded-full ${DOT[ev.dot]}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink group-hover:underline group-hover:decoration-rule-strong group-hover:underline-offset-4">
                        {ev.title}
                      </span>
                      <span className="font-mono text-xs text-ink-3">{ev.time}</span>
                    </span>
                    {ev.extra}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-rule bg-card p-5 text-sm sm:p-6 md:grid-cols-1 md:border-t-0 md:border-l">
          {DETAILS.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-xs text-ink-3">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
