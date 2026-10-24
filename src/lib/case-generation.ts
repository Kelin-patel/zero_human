import { CaseDataError } from "./case-error";
import { createHash } from "node:crypto";
import { z } from "zod";
import { CaseCard, CaseHidden, CaseRecord, Category } from "./case-schema";

export const CASE_SEED = 20261024;
export const NEUTRAL_POSITION = "The store has not approved this refund.";
export const Candidate = z.object({ card: CaseCard, hidden: CaseHidden });
export type Candidate = z.infer<typeof Candidate>;

export const CATEGORIES: { category: Category; count: number; description: string }[] = [
  { category: "C1", count: 8, description: "Change of mind within 14 days, low use (§1); include progress near 20% and bonus-file boundaries." },
  { category: "C2", count: 8, description: "Change of mind with high usage or downloads (§1, §6); distinguish previews from actual bonus downloads." },
  { category: "C3", count: 10, description: "Broken or inaccessible content (§2, §7); show whose fault it is, when reported, and whether fixed within 48 hours." },
  { category: "C4", count: 9, description: "Not as described (§3); distinguish material missing modules/hours from minor stylistic differences." },
  { category: "C5", count: 8, description: "Late requests after 14 days (§6a, §2, §3); include defects reported earlier and requests with no exception." },
  { category: "C6", count: 6, description: "Duplicate or accidental charges (§4); show evidence of the second charge or unopened purchase and hours elapsed." },
  { category: "C7", count: 7, description: "Membership renewals (§5); record renewal time, lessons opened, community posts, and any passive login." },
  { category: "C8", count: 6, description: "Customer-side device, connectivity, or account-sharing problems (§6b); contrast records with the statement." },
  { category: "C9", count: 4, description: "Prior refunds or issued certificates (§6c, §6d); include a prior partial refund and completed-course records." },
  { category: "C10", count: 4, description: "Conflicting or inconclusive evidence (§7); make clear what records establish and what they cannot establish." },
];

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, sorted(entry)]));
  }
  return value;
}

export const canonicalJson = (value: unknown): string => JSON.stringify(sorted(value), null, 2) + "\n";
export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function largestRemainder(weights: readonly number[], seats: number): number[] {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || !Number.isInteger(seats) || seats < 0 || weights.some(value => !Number.isInteger(value) || value < 0)) {
    throw new CaseDataError("Invalid allocation weights or size.");
  }
  const exact = weights.map(weight => weight * seats / total);
  const result = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = seats - result.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i++) result[order[i].index]++;
  return result;
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new CaseDataError("APP_BASE_URL must be an HTTP(S) origin without a path, credentials, query, or fragment.");
  }
  return url.origin;
}

function day(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? millis / 86400000 : null;
}

export function privacyIssues(card: CaseCard): string[] {
  const text = [card.product, card.customer_statement, card.store_position, ...card.evidence.map(item => item.text)].join("\n");
  const issues: string[] = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) issues.push("email address");
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]+)?/g, "");
  const numbers = withoutDates.match(/\+?\d[\d ().-]{7,}\d/g) ?? [];
  if (numbers.some(value => value.replace(/\D/g, "").length >= 10)) issues.push("phone or account number");
  const prose = [card.customer_statement, card.store_position, ...card.evidence.map(item => item.text)]
    .join("\n").replaceAll(card.product, "").replaceAll("Example Academy", "")
    .replaceAll("Resolution Center", "").replace(/https?:\/\/\S+/g, "");
  const introductions = [...prose.matchAll(/\b(my name is|i am|i'm|signed[,:]|signed by|sincerely[,:]?|customer(?:'s)? name[: ]*)\s+([\p{L}'’-]+)\s+([\p{L}'’-]+)/giu)];
  const explicitlyNamed = introductions.some(match => !/^(i am|i'm)$/i.test(match[1]) ||
    (/^\p{Lu}/u.test(match[2]) && /^\p{Lu}/u.test(match[3])));
  const pairs = prose.match(/\b\p{Lu}\p{Ll}+(?:(?:[ ]+(?:van|von|de))?[ '-]\p{Lu}\p{Ll}+)+\b/gu) ?? [];
  // Course terminology and calendar dates are not people's names. Explicit self-identification
  // still wins over this vocabulary, and unfamiliar capitalized pairs are rejected.
  const courseWords = new Set([
    "module", "lesson", "course", "video", "bonus", "file", "download", "certificate", "access",
    "research", "design", "pricing", "email", "marketing", "automation", "client", "contracts",
    "membership", "community", "workshop", "resources", "toolkit", "unit", "chapter", "intro",
    "introduction", "advanced", "basics", "essentials", "pack", "bundle", "report", "support",
    "fundamentals", "tax", "scrum", "spreadsheet", "spreadsheets", "photography", "animation",
    "editing", "portfolio", "agreement", "agreements", "dashboard", "analytics", "sales",
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ]);
  if (explicitlyNamed || pairs.some(pair => !pair.toLowerCase().split(/[ '-]+/).some(word => courseWords.has(word)))) {
    issues.push("possible full name");
  }
  return issues;
}

export function consistencyIssues(candidate: Candidate, baseUrl: string, gold = false): string[] {
  const { card, hidden } = candidate;
  const issues = privacyIssues(card);
  const purchased = day(card.purchased);
  const requested = day(card.requested);
  if (purchased === null || requested === null || requested < purchased || requested - purchased !== card.days_since_purchase) {
    issues.push("purchase/request dates and elapsed days disagree");
  }
  if (!gold && (card.purchased < "2026-10-01" || card.requested > "2026-10-24")) {
    issues.push("candidate dates must be October 1–24, 2026");
  }
  if (card.price_usd < 29 || card.price_usd > 199 || Math.abs(card.price_usd * 100 - Math.round(card.price_usd * 100)) > 1e-6) {
    issues.push("price must be $29–$199 in whole cents");
  }
  if (card.records.certificate_issued && card.records.progress_pct < 90) issues.push("certificate requires at least 90% progress");
  if (card.store_position !== NEUTRAL_POSITION) issues.push("store position must be neutral");
  if (!Number.isFinite(Date.parse(card.records.access_check.checked_at)) || !card.records.access_check.checked_at.startsWith(card.requested)) {
    issues.push("access check must be timestamped on the request date");
  }
  const urls = [card.records.access_check.url, ...card.evidence.map(item => item.url)];
  for (const value of urls) {
    const url = new URL(value);
    if (url.origin !== baseUrl || url.search || url.hash || url.username || url.password ||
      !["/demo/course/ok", "/demo/course/broken", "/demo/terms"].includes(url.pathname)) {
      issues.push("evidence URLs must use the demo routes on APP_BASE_URL");
      break;
    }
  }
  const access = card.records.access_check;
  const path = new URL(access.url).pathname;
  if (!((path === "/demo/course/ok" && access.http_status === 200) || (path === "/demo/course/broken" && access.http_status === 404))) {
    issues.push("access URL does not match its HTTP status");
  }
  const renewal = card.records.membership_renewal_at;
  if (renewal && (!Number.isFinite(Date.parse(renewal)) || requested === null || Date.parse(renewal) >= (requested + 1) * 86400000)) {
    issues.push("renewal timestamp is invalid or after the request day");
  }
  if (!/^§[1-8][a-d]?(?:\s*,\s*§[1-8][a-d]?)*$/.test(hidden.designer_clause)) issues.push("invalid policy clause citation");
  return [...new Set(issues)];
}

export function selectCases(rawCandidates: unknown[], baseUrl: string) {
  if (rawCandidates.length !== 70) throw new CaseDataError("Exactly 70 candidates are required.");
  const rejected: { id: string; reasons: string[] }[] = [];
  const counts = new Map<Category, number>();
  const candidates: Candidate[] = [];
  for (const value of rawCandidates) {
    const envelope = z.object({ card: z.object({ id: z.string() }), hidden: z.object({ category: Category }) }).parse(value);
    counts.set(envelope.hidden.category, (counts.get(envelope.hidden.category) ?? 0) + 1);
    const parsed = Candidate.safeParse(value);
    if (parsed.success) candidates.push(parsed.data);
    else rejected.push({ id: envelope.card.id, reasons: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) });
  }
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const accepted = candidates.filter(candidate => {
    const reasons = consistencyIssues(candidate, baseUrl);
    const { id, ...facts } = candidate.card;
    const fingerprint = sha256(canonicalJson(facts));
    if (seenIds.has(id)) reasons.push("duplicate candidate ID");
    if (seenContent.has(fingerprint)) reasons.push("duplicate candidate content");
    seenIds.add(id);
    seenContent.add(fingerprint);
    if (reasons.length) rejected.push({ id, reasons });
    return reasons.length === 0;
  });
  const weights = CATEGORIES.map(item => item.count);
  const selectedCounts = largestRemainder(weights, 49);
  const devCounts = largestRemainder(selectedCounts, 22);
  const random = mulberry32(CASE_SEED);
  const dev: Candidate[] = [];
  const evaluation: Candidate[] = [];
  const categoryCounts: Record<string, { candidates: number; eligible: number; selected: number; dev: number; eval: number }> = {};
  for (const [index, { category, count }] of CATEGORIES.entries()) {
    if (counts.get(category) !== count) {
      throw new CaseDataError(`Wrong candidate count for ${category}.`);
    }
    const pool = accepted.filter(item => item.hidden.category === category);
    if (pool.length < selectedCounts[index]) {
      const failures = rejected.filter(item => candidates.find(candidate => candidate.card.id === item.id)?.hidden.category === category);
      throw new CaseDataError(`${category} has ${pool.length} eligible candidates but needs ${selectedCounts[index]}. Rejected: ${canonicalJson(failures).trim()}`);
    }
    const picked = shuffle(shuffle(pool, random).slice(0, selectedCounts[index]), random);
    dev.push(...picked.slice(0, devCounts[index]));
    evaluation.push(...picked.slice(devCounts[index]));
    categoryCounts[category] = { candidates: count, eligible: pool.length, selected: picked.length, dev: devCounts[index], eval: picked.length - devCounts[index] };
  }
  const records: CaseRecord[] = [];
  const assignments: { candidate_id: string; case_id: string }[] = [];
  for (const [set, pool] of [["dev", dev], ["eval", evaluation]] as const) {
    shuffle(pool, random).forEach((candidate, index) => {
      const id = `case_${set}_${String(index + 1).padStart(2, "0")}`;
      records.push(CaseRecord.parse({ card: { ...candidate.card, id }, hidden: candidate.hidden, set_name: set }));
      assignments.push({ candidate_id: candidate.card.id, case_id: id });
    });
  }
  return { records, rejected, categoryCounts, assignments };
}
