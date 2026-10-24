"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wordCount, type TaskIdentity, type TaskSession } from "@/lib/task-contract";
import { useTaskIdentity } from "./task-params";

const button = "min-h-12 rounded-xl bg-teal-800 px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700";
const yesNo = (value: boolean) => value ? "Yes" : "No";

export default function TaskReview() {
  const identity = useTaskIdentity();
  return <ReviewFlow key={`${identity.submissionId}:${identity.taskId}`} identity={identity} />;
}

function ReviewFlow({ identity }: { identity: TaskIdentity }) {
  const [session, setSession] = useState<TaskSession | null>(null);
  const [begun, setBegun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [confidence, setConfidence] = useState(0);
  const startedAt = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const storageKey = `review-consent:${identity.submissionId}:${identity.taskId}`;

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/task/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identity), cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSession(data); startedAt.current = Date.now();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load your task. Please retry."); }
    finally { setBusy(false); }
  }, [identity]);

  useEffect(() => {
    let consented = false;
    try { consented = localStorage.getItem(storageKey) === "yes"; } catch { /* Storage is optional. */ }
    const resume = consented ? window.setTimeout(() => { setBegun(true); void load(); }, 0) : null;
    // Resume only when the Terac identity changes.
    return () => { if (resume !== null) window.clearTimeout(resume); };
  }, [storageKey, load]);

  useEffect(() => {
    if (session && !session.card && session.completionUrl) window.location.assign(session.completionUrl);
  }, [session]);

  async function begin() {
    setBegun(true);
    try { localStorage.setItem(storageKey, "yes"); } catch { /* Server-side progress still persists. */ }
    await load();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/task/response", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identity, caseId: session!.card!.id, decision, reason, confidence, secondsSpent: Math.min(7200, Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSession(data); setDecision(""); setReason(""); setConfidence(0); startedAt.current = Date.now();
      heading.current?.focus(); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save. Please retry."); }
    finally { setBusy(false); }
  }

  if (!identity.submissionId || !identity.taskId) return <section className="mx-auto max-w-2xl px-5 py-16"><p className="text-sm font-semibold uppercase tracking-widest text-teal-800">Second Instance</p><h1 className="mt-4 text-3xl font-semibold">Please open this task from Terac.</h1><p className="mt-4 text-slate-600">Your Terac task link identifies your review and saves your progress.</p></section>;

  const errorBox = error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">{error}</p>;
  if (!begun) return <section className="mx-auto max-w-2xl space-y-6 px-5 py-12"><p className="text-sm font-semibold uppercase tracking-widest text-teal-800">Second Instance · Prepared cases</p><h1 className="text-4xl font-semibold tracking-tight">A fair reading of the refund policy.</h1><p className="text-lg leading-8">You’ll review up to 8 short refund disputes for Example Academy, a fictional online course store. Apply the store’s written policy to each case. A couple of cards are simple attention checks.</p><div className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold">Before you begin</h2><ul className="mt-4 list-disc space-y-3 pl-5 leading-7"><li>Read the policy and each case’s records, statement, and evidence.</li><li>Choose approve, deny, or need more evidence. Explain why in at least 10 words and rate your confidence.</li><li>Your answers are saved after every card. Reopen the same Terac link to resume.</li><li>Participation is voluntary. Your responses will be used to evaluate refund decisions. Please do not include your name, contact details, or other personal information.</li></ul></div><p className="text-sm text-slate-600">By starting, you consent to the use of your responses for this evaluation.</p><button className={button} onClick={begin} disabled={busy}>I agree — start reviewing</button></section>;
  if (!session) return <section className="mx-auto max-w-2xl space-y-6 px-5 py-16"><h1 className="text-2xl font-semibold">{busy ? "Loading your review…" : "Your review"}</h1>{errorBox}{!busy && <button className={button} onClick={load}>Try again</button>}</section>;
  if (!session.card) return <section className="mx-auto max-w-2xl space-y-6 px-5 py-16"><p className="text-sm font-semibold text-teal-800">{session.completed} of {session.total} cards saved</p><h1 className="text-4xl font-semibold">Thank you, you’re done.</h1><p className="text-lg">{session.completionUrl ? "Returning you to Terac…" : "Return to Terac and mark the task complete."}</p>{session.completionUrl && <a className="inline-block text-teal-800 underline" href={session.completionUrl}>Continue to Terac</a>}{session.isTest && <p className="rounded-xl bg-amber-100 p-4">Test review complete. These responses are excluded from results.</p>}</section>;
  const card = session.card;
  const records = card.records;
  const words = wordCount(reason);
  return <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-8">
    <header className="py-7"><p className="text-sm font-semibold uppercase tracking-widest text-teal-800">Second Instance · Example Academy (fictional)</p>{session.isTest && <p className="mt-3 rounded-lg bg-amber-100 p-3 text-sm">Test mode · excluded from results</p>}<div className="mt-5 flex items-center justify-between"><h1 className="text-xl font-semibold">Refund review</h1><span className="text-sm" aria-live="polite">Card {session.completed + 1} of {session.total}</span></div><progress className="mt-3 h-2 w-full accent-teal-800" max={session.total} value={session.completed} aria-label="Cards completed" /></header>
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      <aside className="sticky top-0 z-10 rounded-2xl border border-teal-200 bg-teal-50 p-4 shadow-sm lg:col-start-2 lg:row-start-1 lg:top-4" aria-label="Refund policy"><h2 className="font-semibold text-teal-950">Policy · always here for reference</h2><div className="mt-3 max-h-36 overflow-y-auto overscroll-contain lg:max-h-[60vh]" tabIndex={0} aria-label="Scroll policy summary"><table className="w-full text-left text-sm"><thead className="sr-only"><tr><th>Situation</th><th>Refund?</th></tr></thead><tbody>{session.policy.summary.map(([situation, answer]) => <tr key={situation} className="border-b border-teal-200 last:border-0"><td className="py-2 pr-3 align-top">{situation}</td><td className="py-2 align-top">{answer}</td></tr>)}</tbody></table></div><details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 font-semibold text-teal-900">Show full policy</summary><pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-6">{session.policy.text}</pre></details></aside>
      <div className="space-y-6 lg:col-start-1 lg:row-start-1"><article className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"><div><p className="text-sm text-slate-500">Prepared dispute</p><h2 ref={heading} tabIndex={-1} className="mt-1 text-2xl font-semibold outline-none">{card.product}</h2><p className="mt-2 text-xl font-semibold text-teal-800">${card.price_usd.toFixed(2)}</p></div><dl className="grid grid-cols-2 gap-4 text-sm"><Fact label="Purchased" value={card.purchased} /><Fact label="Refund requested" value={card.requested} /><Fact label="Days since purchase" value={String(card.days_since_purchase)} /><Fact label="Course progress" value={`${records.progress_pct}%`} /><Fact label="Bonus files downloaded" value={yesNo(records.bonus_files_downloaded)} /><Fact label="Certificate issued" value={yesNo(records.certificate_issued)} /><Fact label="Prior refunds for this course" value={String(records.prior_refunds_for_this_course)} />{records.membership_renewal_at && <Fact label="Membership renewed" value={records.membership_renewal_at} />}{records.duplicate_charge !== undefined && <Fact label="Duplicate charge" value={yesNo(records.duplicate_charge)} />}{records.disputed !== undefined && <Fact label="Payment disputed" value={yesNo(records.disputed)} />}</dl><section className="rounded-xl bg-slate-100 p-4 text-sm"><h3 className="font-semibold">Access check</h3><p className="mt-2">HTTP {records.access_check.http_status} · {records.access_check.checked_at}</p><p className="mt-1 break-all">{records.access_check.url}</p></section><section><h3 className="font-semibold">Customer’s statement</h3><blockquote className="mt-2 whitespace-pre-wrap border-l-4 border-teal-300 pl-4 leading-7">{card.customer_statement}</blockquote></section><section><h3 className="font-semibold">Store position</h3><p className="mt-2 leading-7">{card.store_position}</p></section><section><h3 className="font-semibold">Evidence</h3><ul className="mt-3 space-y-4">{card.evidence.map((item, i) => <li key={i} className="rounded-xl border border-slate-200 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.kind.replaceAll("_", " ")}</p><p className="mt-2 whitespace-pre-wrap leading-7">{item.text}</p><p className="mt-2 break-all text-xs text-slate-500">{item.url}</p></li>)}</ul></section></article>
      <form onSubmit={save} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7"><fieldset disabled={busy}><legend className="text-xl font-semibold">Your decision</legend><div className="mt-4 grid gap-3">{[["approve", "Approve refund"], ["deny", "Deny refund"], ["need_more_evidence", "Need more evidence"]].map(([value, label]) => <label key={value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-4 ${decision === value ? "border-teal-800 bg-teal-50" : "border-slate-300"}`}><input type="radio" name="decision" required value={value} checked={decision === value} onChange={() => setDecision(value)} className="h-5 w-5 accent-teal-800" />{label}</label>)}</div></fieldset><div><label htmlFor="reason" className="font-semibold">Why? Use the policy and the facts.</label><p id="reason-hint" className="mt-1 text-sm text-slate-600">At least 10 words. Do not include personal information.</p><textarea id="reason" value={reason} maxLength={3000} onChange={event => setReason(event.target.value)} rows={5} required disabled={busy} aria-describedby="reason-hint word-count" className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-base focus:outline-2 focus:outline-teal-700" /><p id="word-count" aria-live="polite" className={`mt-1 text-sm ${words >= 10 ? "text-teal-800" : "text-slate-600"}`}>{words} / 10 words minimum</p></div><fieldset disabled={busy}><legend className="font-semibold">How confident are you?</legend><p className="mt-1 text-sm text-slate-600">1 = unsure · 5 = very confident</p><div className="mt-3 flex gap-2">{[1, 2, 3, 4, 5].map(value => <label key={value} className={`flex min-h-12 min-w-12 cursor-pointer items-center justify-center rounded-xl border ${confidence === value ? "border-teal-800 bg-teal-50" : "border-slate-300"}`}><input type="radio" name="confidence" required value={value} checked={confidence === value} onChange={() => setConfidence(value)} className="sr-only peer" /><span className="rounded px-2 peer-focus-visible:outline-2 peer-focus-visible:outline-teal-700">{value}</span></label>)}</div></fieldset>{errorBox}<button type="submit" className={`${button} w-full`} disabled={busy || !decision || words < 10 || !confidence}>{busy ? "Saving…" : session.completed + 1 === session.total ? "Save and finish" : "Save and continue"}</button><p className="text-sm text-slate-500">Each answer is final once saved.</p></form></div>
    </div>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>;
}
