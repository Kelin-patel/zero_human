"use client";

import { useEffect, useState } from "react";
import type { CaseView } from "@/lib/repo";

const POLL_MS = 3000;

const money = (cents: number | null) => (cents == null ? "" : `$${(cents / 100).toFixed(2)}`);
const day = (value: string | null) => (value ? value.slice(0, 10) : "");
const time = (value: string | null) => (value ? new Date(value).toLocaleTimeString() : "");

const DECISION_LABEL: Record<string, { text: string; className: string }> = {
  approve: { text: "Approved", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  deny: { text: "Denied", className: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200" },
  out_of_scope: { text: "Needs a person", className: "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" },
  need_more_evidence: { text: "Needs more evidence", className: "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" },
};

const EVIDENCE_LABELS: Record<string, string> = {
  solari_check: "Course access check",
  http_check: "Course access check",
  exa_terms: "Store terms excerpt",
};

function Badge({ decision }: { decision: string }) {
  const label = DECISION_LABEL[decision] ?? { text: decision, className: "bg-zinc-200 text-zinc-900" };
  return <span className={`rounded-full px-3 py-1 text-sm font-medium ${label.className}`}>{label.text}</span>;
}

function Step({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="relative border-l border-zinc-200 pb-6 pl-6 last:pb-0 dark:border-zinc-800">
      <span
        className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${
          done ? "bg-zinc-900 dark:bg-zinc-100" : "border border-zinc-400 bg-white dark:bg-zinc-950"
        }`}
      />
      <h2 className="mb-2 font-medium">{title}</h2>
      <div className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">{children}</div>
    </li>
  );
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {(view.publicNote || view.setName === "demo") && (
          <p className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            {view.publicNote ?? "Prepared demo · fictional store · no real money"}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">Your refund request</h1>
        <p className="text-sm text-zinc-500">Reference {view.id}. This page updates on its own.</p>
      </div>

      <ol className="flex flex-col">
        <Step title="Request received" done>
          <p>
            <span className="font-medium">{view.product}</span> · {money(view.amountCents)}
          </p>
          <p>
            Purchased {day(view.purchasedAt)} · requested {day(view.requestedAt)}
          </p>
          {view.customerStatement && (
            <blockquote className="whitespace-pre-wrap border-l-2 border-zinc-300 pl-3 italic dark:border-zinc-700">
              {view.customerStatement}
            </blockquote>
          )}
        </Step>

        <Step title="AI support desk decision" done={Boolean(decision)}>
          {decision ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge decision={decision.decision} />
                {decision.clauses.length > 0 && (
                  <span className="text-zinc-500">Policy {decision.clauses.join(", ")}</span>
                )}
              </div>
              <p>{decision.reason}</p>
              {decision.decision === "approve" && !view.execution && (
                <p className="text-zinc-500">
                  {view.hasPayment
                    ? "Approved. The refund is being issued on Whop within the store's limits…"
                    : "Approved. This demo order has no real payment, so nothing is refunded."}
                </p>
              )}
            </>
          ) : (
            <p className="text-zinc-500">Three AI reviewers and a devil&apos;s advocate are reading the policy. This usually takes under a minute.</p>
          )}
        </Step>

        {(canAppeal || appealed || verdict) && (
          <Step title="Independent human review" done={Boolean(verdict) || view.reviews.length > 0}>
            {canAppeal && (
              <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <p>
                  Disagree? A verified person who has never seen this case will apply the same written policy.
                  If they find the refund is due, it&apos;s carried out automatically.
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 600))}
                  rows={3}
                  placeholder="Anything the reviewer should know? (optional, no contact or card details)"
                  className="rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
                />
                {appealError && <p className="text-red-600">{appealError}</p>}
                <button
                  onClick={appeal}
                  disabled={appealing}
                  className="rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {appealing ? "Requesting…" : "Request independent human review"}
                </button>
              </div>
            )}
            {appealed && (
              <>
                <p>Requested at {time(view.appealedAt)}.</p>
                {view.appealStatement && (
                  <blockquote className="whitespace-pre-wrap border-l-2 border-zinc-300 pl-3 italic dark:border-zinc-700">
                    {view.appealStatement}
                  </blockquote>
                )}
                {view.reviews.length === 0 && !verdict && (
                  <p className="text-zinc-500">
                    Queued for independent review by verified people through Terac. The evidence is gathered first.
                  </p>
                )}
              </>
            )}
            {verdict && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge decision={verdict.decision} />
                  <span>{verdict.reason}</span>
                </div>
                {verdict.reviewers.map((r, i) => (
                  <div key={i} className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                    <span className="text-xs text-zinc-500">
                      Reviewer {r.reviewer} · {DECISION_LABEL[r.decision]?.text ?? r.decision}
                    </span>
                    {r.reason && <p>&ldquo;{r.reason}&rdquo;</p>}
                  </div>
                ))}
              </div>
            )}
            {view.reviews.map((review, i) => (
              <div key={i} className="flex flex-col gap-1">
                <Badge decision={review.decision} />
                {review.reason && <p>&ldquo;{review.reason}&rdquo;</p>}
              </div>
            ))}
          </Step>
        )}

        {view.evidence.length > 0 && (
          <Step title="Evidence checked" done>
            {view.evidence.map((e, i) => (
              <div key={i} className="flex flex-col gap-2">
                <p className="whitespace-pre-wrap">
                  <span className="font-medium">{EVIDENCE_LABELS[e.kind] ?? e.kind.replace(/_/g, " ")}:</span> {e.summary}
                  {e.httpStatus != null && <span className="text-zinc-500"> (HTTP {e.httpStatus})</span>}
                </p>
                {e.url && <p className="break-all text-xs text-zinc-500">{e.url}</p>}
                {e.screenshotUrl && (
                  <a href={e.screenshotUrl} target="_blank" rel="noopener noreferrer" className="w-fit">
                    {/* eslint-disable-next-line @next/next/no-img-element -- screenshot bytes are served from our own API */}
                    <img
                      src={e.screenshotUrl}
                      alt={`Screenshot of ${e.url ?? "the checked page"}`}
                      className="max-h-48 w-auto rounded border border-zinc-200 dark:border-zinc-800"
                    />
                  </a>
                )}
              </div>
            ))}
          </Step>
        )}

        {view.execution && (
          <Step title="Outcome" done={view.execution.status === "succeeded"}>
            {view.execution.status === "blocked" ? (
              <p>Refund not issued: {view.execution.blockReason}</p>
            ) : view.execution.status === "failed" ? (
              <p>
                All checks passed, but Whop did not complete the refund: {view.execution.blockReason}. Nothing was
                refunded.
              </p>
            ) : (
              <>
                <p>
                  Refund of {money(view.execution.amountCents)} {view.execution.status} on Whop
                  {view.execution.environment === "sandbox" ? " (sandbox, no real money)" : ""}.
                </p>
                {view.execution.whopRefundId && (
                  <p className="text-zinc-500">Whop refund ID {view.execution.whopRefundId}</p>
                )}
              </>
            )}
          </Step>
        )}
      </ol>

      <p className="text-xs text-zinc-500">
        You keep all your other rights, including Whop&apos;s Resolution Center and your card issuer.
      </p>
    </div>
  );
}
