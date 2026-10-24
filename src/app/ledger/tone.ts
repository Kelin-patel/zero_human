export type Tone = "ok" | "bad" | "warn" | "neutral";

export const TONE_BADGE: Record<Tone, string> = {
  ok: "badge badge-ok",
  bad: "badge badge-bad",
  warn: "badge badge-warn",
  neutral: "badge badge-neutral",
};

/** Classify a decision or status by meaning: good outcomes, refusals and failures, holds. */
export function decisionTone(decision: string): Tone {
  const d = decision.toLowerCase();
  if (/(deny|denied|refus|fail|block|reject|error|out_of_scope|abort|cancel)/.test(d)) return "bad";
  if (/(pause|resume|skip|hold|wait|queue|defer|pending|draft)/.test(d)) return "warn";
  if (/(approve|^ok|refund|sale|issue|buy|launch|book|complete|accept|grant|paid|pass|provision|active|running)/.test(d)) return "ok";
  return "neutral";
}

/** "buy_humans" -> "Buy humans" */
export function humanize(code: string): string {
  const s = code.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : code;
}
