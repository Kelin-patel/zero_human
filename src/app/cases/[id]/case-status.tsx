"use client";

import { useEffect, useState } from "react";
import type { CaseView } from "@/lib/repo";

const POLL_MS = 3000;

const money = (cents: number | null) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);
const day = (value: string | null) => (value ? value.slice(0, 10) : "");
const time = (value: string | null) => (value ? new Date(value).toLocaleTimeString("en-US", { timeZone: "America/New_York" }) + " ET" : "");

type Tone = "ok" | "bad" | "warn" | "info" | "neutral";

const BADGE: Record<Tone, string> = {
  ok: "badge badge-ok",
  bad: "badge badge-bad",
  warn: "badge badge-warn",
  info: "badge badge-info",
  neutral: "badge badge-neutral",
};

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  bad: "bg-bad",
  warn: "bg-warn",
  info: "bg-info",
  neutral: "bg-ink-3",
};

const DECISION_LABEL: Record<string, { text: string; tone: Tone }> = {
  approve: { text: "Approved", tone: "ok" },
  deny: { text: "Denied", tone: "bad" },
  out_of_scope: { text: "Needs a person", tone: "neutral" },
  need_more_evidence: { text: "Needs more evidence", tone: "neutral" },
};

const EVIDENCE_LABELS: Record<string, string> = {
  solari_check: "Course access check",
  http_check: "Course access check",
  exa_terms: "Store terms excerpt",
};

const EVIDENCE_SOURCE: Record<string, string> = {
  solari_check: "Solari remote browser",
  http_check: "HTTP check",
  exa_terms: "Exa",
};

function Badge({ decision }: { decision: string }) {
  const label = DECISION_LABEL[decision] ?? { text: decision, tone: "neutral" as Tone };
  return <span className={BADGE[label.tone]}>{label.text}</span>;
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="whitespace-pre-wrap border-l-2 border-rule-strong pl-4 text-ink-2">{children}</blockquote>
  );
}

function Item({
  title,
  tone,
  pending = false,
  meta,
  last = false,
  children,
}: {
  title: string;
  tone: Tone;
  pending?: boolean;
  meta?: React.ReactNode;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className={`relative pl-7 ${last ? "" : "pb-7"}`}>
      {!last && <span aria-hidden className="absolute bottom-0 left-[4px] top-[18px] w-px bg-rule" />}
      <span
        aria-hidden
        className={`absolute left-0 top-[6px] h-[9px] w-[9px] rounded-full ring-4 ring-card ${
          pending ? "border border-ink-3 bg-card" : DOT[tone]
        }`}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className={`text-sm font-medium ${pending ? "text-ink-3" : "text-ink"}`}>{title}</h3>
        <span className="font-mono text-xs text-ink-3">{pending ? "Pending" : meta}</span>
      </div>
      {children && (
        <div
          className={`mt-2 flex min-w-0 flex-col gap-3 text-sm leading-relaxed ${pending ? "text-ink-3" : "text-ink-2"}`}
        >
          {children}
        </div>
      )}
    </li>
  );
}

function httpTone(status: number): Tone {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400) return "bad";
  return "neutral";
}

function overallStatus(view: CaseView): { text: string; tone: Tone } {
  const x = view.execution;
  if (x) {
    if (x.status === "succeeded") return { text: "Refunded", tone: "ok" };
    if (x.status === "blocked") return { text: "Refund not issued", tone: "bad" };
    if (x.status === "failed") return { text: "Refund failed", tone: "bad" };
    return { text: `Refund ${x.status}`, tone: "warn" };
  }
  if (view.humanVerdict) {
    const label = DECISION_LABEL[view.humanVerdict.decision];
    return { text: `Human review: ${label?.text ?? view.humanVerdict.decision}`, tone: label?.tone ?? "neutral" };
  }
  if (view.appealedAt) return { text: "Under independent review", tone: "warn" };
  if (view.decision) {
    const label = DECISION_LABEL[view.decision.decision];
    return { text: label?.text ?? view.decision.decision, tone: label?.tone ?? "neutral" };
  }
  return { text: "In review", tone: "neutral" };
}

export default function CaseStatus({ initial }: { initial: CaseView }) {
  const [view, setView] = useState(initial);
  const [note, setNote] = useState("");
  const [appealError, setAppealError] = useState<string | null>(null);
  const [appealing, setAppealing] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/cases/${initial.id}`, { cache: "no-store" });
        if (res.ok && active) setView(await res.json());
      } catch {
        // Keep showing the last known state; the next poll retries.
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initial.id]);

  async function appeal() {
    setAppealing(true);
    setAppealError(null);
    try {
      const res = await fetch(`/api/cases/${view.id}/appeal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(note.trim() ? { statement: note.trim() } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not request the review.");
      setView({ ...view, status: "appealed", appealedAt: new Date().toISOString(), appealStatement: note.trim() || null });
    } catch (err) {
      setAppealError(err instanceof Error ? err.message : "Could not request the review.");
    } finally {
      setAppealing(false);
    }
  }

  const decision = view.decision;
  const verdict = view.humanVerdict;
  const appealed = Boolean(view.appealedAt);
  const canAppeal = decision?.decision === "deny" && view.status === "decided" && !appealed;
  const execution = view.execution;
  const isDemo = view.setName === "demo";
  const status = overallStatus(view);

  const executionTone: Tone = !execution
    ? "neutral"
    : execution.status === "succeeded"
      ? "ok"
      : execution.status === "blocked" || execution.status === "failed"
        ? "bad"
        : "warn";

  // Which items are on the activity timeline, in order.
  const showAppeal = canAppeal || appealed;
  const showEvidence = view.evidence.length > 0 || appealed;
  const showReview = appealed || view.reviews.length > 0 || Boolean(verdict);
  const showVerdict = Boolean(verdict) || appealed;
  const showRefund = Boolean(execution) || (appealed && (!verdict || verdict.decision === "approve"));
  const order = [
    "request",
    "ai",
    showAppeal && "appeal",
    showEvidence && "evidence",
    showReview && "review",
    showVerdict && "verdict",
    showRefund && "refund",
  ].filter(Boolean) as string[];
  const lastItem = order[order.length - 1];

  const details: { label: string; value: React.ReactNode }[] = [
    { label: "Status", value: <span className={BADGE[status.tone]}>{status.text}</span> },
  ];
  if (view.amountCents != null) {
    details.push({ label: "Amount", value: <span className="font-mono">{money(view.amountCents)}</span> });
  }
  if (isDemo) details.push({ label: "Store", value: "Example Academy (fictional)" });
  if (view.purchasedAt) details.push({ label: "Purchased", value: <span className="font-mono">{day(view.purchasedAt)}</span> });
  if (view.requestedAt) details.push({ label: "Requested", value: <span className="font-mono">{day(view.requestedAt)}</span> });
  if (decision) {
    details.push({
      label: "Decided by",
      value: verdict ? "AI support desk, then independent human review" : "AI support desk",
    });
  }
  details.push({
    label: "Payment",
    value: (
      <span className="flex flex-wrap items-center justify-end gap-2">
        {view.hasPayment ? "Whop" : "No real payment"}
        {execution?.environment === "sandbox" && <span className="badge badge-warn">Sandbox</span>}
      </span>
    ),
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm text-ink-3">
          <span>Cases</span>
          <span>/</span>
          <span className="min-w-0 truncate font-mono">{view.id}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink">
            {view.product ?? "Your refund request"}
          </h1>
          <span className={BADGE[status.tone]}>{status.text}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
          {view.amountCents != null && <span className="font-mono text-ink">{money(view.amountCents)}</span>}
          {isDemo && <span>Example Academy (fictional)</span>}
          {(view.publicNote || isDemo) && (
            <span className="badge badge-warn whitespace-normal">
              {view.publicNote ?? "Prepared demo · fictional store · no real money"}
            </span>
          )}
        </div>
        <p className="text-sm text-ink-3">
          Your refund request. Reference <span className="break-all font-mono">{view.id}</span>. This page updates on
          its own.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Activity */}
        <section className="panel min-w-0">
          <h2 className="border-b border-rule px-5 py-4 text-sm font-semibold text-ink sm:px-6">Activity</h2>
          <ol className="px-5 py-6 sm:px-6">
            <Item title="Request received" tone="info" meta={day(view.requestedAt)} last={lastItem === "request"}>
              <p>
                <span className="font-medium text-ink">{view.product}</span> ·{" "}
                <span className="font-mono text-ink">{money(view.amountCents)}</span>
              </p>
              <p>
                Purchased <span className="font-mono">{day(view.purchasedAt)}</span> · requested{" "}
                <span className="font-mono">{day(view.requestedAt)}</span>
              </p>
              {view.customerStatement && <Quote>{view.customerStatement}</Quote>}
            </Item>

            <Item
              title="AI support desk decision"
              tone={decision ? (DECISION_LABEL[decision.decision]?.tone ?? "neutral") : "neutral"}
              pending={!decision}
              meta={decision ? time(decision.decidedAt) : undefined}
              last={lastItem === "ai"}
            >
              {decision ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge decision={decision.decision} />
                    {decision.clauses.length > 0 && <span className="text-xs text-ink-3">Policy</span>}
                    {decision.clauses.map((clause, i) => (
                      <span key={`${clause}-${i}`} className="badge badge-neutral font-mono">
                        {clause}
                      </span>
                    ))}
                  </div>
                  <p className="text-ink">{decision.reason}</p>
                  {decision.decision === "approve" && !execution && (
                    <p>
                      {view.hasPayment
                        ? "Approved. The refund is being issued on Whop within the store's limits…"
                        : "Approved. This demo order has no real payment, so nothing is refunded."}
                    </p>
                  )}
                </>
              ) : (
                <p>
                  Three AI reviewers and a devil&apos;s advocate are reading the policy. This usually takes under a
                  minute.
                </p>
              )}
            </Item>

            {showAppeal && (
              <Item
                title={appealed ? "Independent review requested" : "Appeal"}
                tone={appealed ? "info" : "warn"}
                meta={appealed ? time(view.appealedAt) : undefined}
                last={lastItem === "appeal"}
              >
                {canAppeal && (
                  <div className="flex flex-col gap-3 rounded-lg border border-rule bg-subtle p-4">
                    <h4 className="text-sm font-semibold text-ink">Ask for an independent human review</h4>
                    <p>
                      Disagree? A verified person who has never seen this case will apply the same written policy. If
                      they find the refund is due, it&apos;s carried out automatically.
                    </p>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value.slice(0, 600))}
                      rows={3}
                      placeholder="Anything the reviewer should know? (optional, no contact or card details)"
                      className="block w-full resize-y rounded-lg border border-rule-strong bg-card p-3 text-[15px] text-ink transition-colors duration-150 placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                    />
                    {appealError && (
                      <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-bad">
                        {appealError}
                      </p>
                    )}
                    <div>
                      <button
                        onClick={appeal}
                        disabled={appealing}
                        className="btn-primary justify-center disabled:cursor-not-allowed"
                      >
                        {appealing && (
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 animate-spin">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                        )}
                        {appealing ? "Requesting…" : "Request independent human review"}
                      </button>
                    </div>
                  </div>
                )}
                {appealed && (
                  <>
                    <p>
                      Requested at <span className="font-mono">{time(view.appealedAt)}</span>.
                    </p>
                    {view.appealStatement && <Quote>{view.appealStatement}</Quote>}
                  </>
                )}
              </Item>
            )}

            {showEvidence && (
              <Item
                title="Evidence checked"
                tone="info"
                pending={view.evidence.length === 0}
                meta={view.evidence.length > 0 ? time(view.evidence[0].capturedAt) : undefined}
                last={lastItem === "evidence"}
              >
                {view.evidence.map((e, i) => {
                  const caption = (
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink-2">
                      <span className="font-medium text-ink">{EVIDENCE_LABELS[e.kind] ?? e.kind.replace(/_/g, " ")}</span>
                      {EVIDENCE_SOURCE[e.kind] && <span className="text-ink-3">{EVIDENCE_SOURCE[e.kind]}</span>}
                      {e.httpStatus != null && (
                        <span className={`${BADGE[httpTone(e.httpStatus)]} font-mono`}>HTTP {e.httpStatus}</span>
                      )}
                      {e.url && (
                        <span className="block min-w-0 max-w-full truncate font-mono text-ink-3" title={e.url}>
                          {e.url}
                        </span>
                      )}
                    </div>
                  );
                  return (
                    <div key={i} className="flex min-w-0 flex-col gap-2">
                      {e.screenshotUrl ? (
                        <figure className="overflow-hidden rounded-lg border border-rule">
                          <a href={e.screenshotUrl} target="_blank" rel="noopener noreferrer" className="block bg-subtle">
                            {/* eslint-disable-next-line @next/next/no-img-element -- screenshot bytes are served from our own API */}
                            <img
                              src={e.screenshotUrl}
                              alt={`Screenshot of ${e.url ?? "the checked page"}`}
                              className="block max-h-[420px] w-full object-cover object-top"
                            />
                          </a>
                          <figcaption className="border-t border-rule bg-card px-3 py-2">{caption}</figcaption>
                        </figure>
                      ) : (
                        caption
                      )}
                      {e.summary &&
                        (e.kind === "exa_terms" ? (
                          <Quote>{e.summary}</Quote>
                        ) : (
                          <p className="whitespace-pre-wrap">{e.summary}</p>
                        ))}
                    </div>
                  );
                })}
              </Item>
            )}

            {showReview && (
              <Item
                title="Independent human review · Terac"
                tone={view.reviews.length > 0 || verdict ? "info" : "warn"}
                meta={view.reviews.length > 0 ? time(view.reviews[view.reviews.length - 1].createdAt) : undefined}
                last={lastItem === "review"}
              >
                {appealed && view.reviews.length === 0 && !verdict && (
                  <p>Queued for independent review by verified people through Terac. The evidence is gathered first.</p>
                )}
                {view.reviews.map((review, i) => (
                  <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-rule p-3">
                    <Badge decision={review.decision} />
                    {review.reason && <p>&ldquo;{review.reason}&rdquo;</p>}
                  </div>
                ))}
              </Item>
            )}

            {showVerdict && (
              <Item
                title="Human verdict"
                tone={verdict ? (DECISION_LABEL[verdict.decision]?.tone ?? "neutral") : "neutral"}
                pending={!verdict}
                meta={verdict ? time(verdict.decidedAt) : undefined}
                last={lastItem === "verdict"}
              >
                {verdict && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge decision={verdict.decision} />
                    </div>
                    <p className="text-ink">{verdict.reason}</p>
                    {verdict.reviewers.map((r, i) => (
                      <div key={i} className="flex flex-col gap-1 rounded-lg border border-rule p-3">
                        <span className="text-xs text-ink-3">
                          Reviewer <span className="font-mono">{r.reviewer}</span> ·{" "}
                          {DECISION_LABEL[r.decision]?.text ?? r.decision}
                        </span>
                        {r.reason && <p>&ldquo;{r.reason}&rdquo;</p>}
                      </div>
                    ))}
                  </>
                )}
              </Item>
            )}

            {showRefund && (
              <Item
                title="Outcome"
                tone={executionTone}
                pending={!execution}
                meta={execution ? time(execution.createdAt) : undefined}
                last={lastItem === "refund"}
              >
                {execution &&
                  (execution.status === "blocked" ? (
                    <p className="text-ink">Refund not issued: {execution.blockReason}</p>
                  ) : execution.status === "failed" ? (
                    <p className="text-ink">
                      All checks passed, but Whop did not complete the refund: {execution.blockReason}. Nothing was
                      refunded.
                    </p>
                  ) : (
                    <>
                      <p className="flex flex-wrap items-center gap-2 text-ink">
                        <span>
                          Refund of <span className="font-mono">{money(execution.amountCents)}</span> {execution.status}{" "}
                          on Whop
                          {execution.environment === "sandbox" ? " (sandbox, no real money)" : ""}.
                        </span>
                        {execution.environment === "sandbox" && <span className="badge badge-warn">Sandbox</span>}
                      </p>
                      {execution.whopRefundId && (
                        <p className="text-ink-3">
                          Whop refund ID <span className="break-all font-mono text-ink-2">{execution.whopRefundId}</span>
                        </p>
                      )}
                    </>
                  ))}
              </Item>
            )}
          </ol>
        </section>

        {/* Details */}
        <aside className="panel h-fit min-w-0">
          <h2 className="border-b border-rule px-5 py-4 text-sm font-semibold text-ink">Details</h2>
          <dl className="flex flex-col divide-y divide-rule px-5">
            {details.map((d) => (
              <div key={d.label} className="flex items-start justify-between gap-4 py-3">
                <dt className="shrink-0 text-sm text-ink-3">{d.label}</dt>
                <dd className="min-w-0 text-right text-sm text-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <p className="text-xs text-ink-3">
        You keep all your other rights, including Whop&apos;s Resolution Center and your card issuer.
      </p>
    </div>
  );
}
