import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256 } from "./case-generation";
import { loadPreparedInputs, validateBaseline } from "./prepared-baseline";

export const REGISTERED_FILES = ["policy.v1.md", "cases.frozen.json", "prepared-review.config.json", "decisions_v1.json", "assignment.json"] as const;
type RegisteredFiles = Record<typeof REGISTERED_FILES[number], string>;

export function registeredRound(text: string) {
  const sample = text.match(/(\d+) participants\s*[×x]\s*(\d+) cards/);
  const price = text.match(/(?:quoted cost of|machine-estimated draft quote of)\s*\*\*\$(\d+)\.(\d{2}) per participant/);
  const mode = text.match(/review type:\s*(auto_approve|self_report|manual_review)/i);
  if (!sample || !price || !mode || !text.includes("17:30 America/New_York on October 24, 2026")) {
    throw new Error("Registered recruitment count, price, completion mode or stop time is missing or unsupported.");
  }
  return { n: Number(sample[1]), cardsPerReviewer: Number(sample[2]), cpiCents: Number(price[1]) * 100 + Number(price[2]), reviewType: mode[1].toLowerCase() };
}

export function verifyRegisteredHashes(registration: string, files: RegisteredFiles): void {
  for (const name of REGISTERED_FILES) {
    const hashes = registration.split(/\r?\n/).filter(line => line.includes(name)).flatMap(line => line.match(/\b[a-f0-9]{64}\b/gi) ?? []);
    if (hashes.length !== 1 || hashes[0].toLowerCase() !== sha256(files[name])) {
      throw new Error(`Registration must list exactly one matching SHA-256 for ${name}.`);
    }
  }
}

export function validateReviewAssignments(value: unknown, n: number, cardsPerReviewer: number, caseIds: Set<string>): void {
  const container = value as { slots?: unknown; assignments?: unknown } | null;
  const slots = Array.isArray(value) ? value : container?.slots ?? container?.assignments;
  if (!Array.isArray(slots)) throw new Error("Assignments must contain an array of slots.");
  const primary = slots.map(item => {
    const row = item as { slot?: number; slot_id?: number; case_ids?: unknown; cases?: unknown };
    const id = row.slot ?? row.slot_id;
    return { slot: id, ids: row.case_ids ?? row.cases };
  }).filter(row => Number.isInteger(row.slot) && Number(row.slot) >= 1 && Number(row.slot) <= 11);
  if (primary.length !== n || new Set(primary.map(row => row.slot)).size !== n ||
      primary.some(row => Number(row.slot) > n)) throw new Error("Registered primary slot count differs from the quoted participant count.");
  for (const row of primary) {
    if (!Array.isArray(row.ids) || row.ids.length !== cardsPerReviewer) throw new Error("Registered cards per reviewer differ from the quoted task duration.");
    const ids = row.ids.map(item => typeof item === "string" ? item : item?.id ?? item?.case_id);
    if (ids.some(id => typeof id !== "string" || !caseIds.has(id)) || new Set(ids).size !== ids.length || ids.filter(id => id.startsWith("case_gold_")).length !== 1) {
      throw new Error("An assignment has unknown/repeated cases or does not contain exactly one gold card.");
    }
  }
}

export function loadRegisteredReview(n: number, cardsPerReviewer: number) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  try { git("fetch", "origin", "main"); }
  catch { throw new Error("Could not refresh origin/main; launch is blocked."); }
  let registration: string;
  try { registration = git("show", "origin/main:data/PREREGISTRATION.md"); }
  catch { throw new Error("Launch requires data/PREREGISTRATION.md committed on origin/main."); }
  const files = Object.fromEntries(REGISTERED_FILES.map(name => {
    let committed: string;
    try { committed = git("show", `origin/main:data/${name}`); }
    catch { throw new Error(`Launch requires data/${name} on origin/main.`); }
    if (readFileSync(`data/${name}`, "utf8") !== committed) throw new Error(`Local data/${name} differs from origin/main.`);
    return [name, committed];
  })) as RegisteredFiles;
  if (readFileSync("data/PREREGISTRATION.md", "utf8") !== registration) throw new Error("The local registration differs from origin/main.");
  verifyRegisteredHashes(registration, files);
  const round = registeredRound(registration);
  if (round.n !== n || round.cardsPerReviewer !== cardsPerReviewer) throw new Error("The registered sample differs from the Terac quote.");
  const inputs = loadPreparedInputs();
  const baseline = validateBaseline(JSON.parse(files["decisions_v1.json"]), inputs.config.case_ids);
  if (canonicalJson(baseline) !== files["decisions_v1.json"]) throw new Error("Baseline is not canonical JSON.");
  const goldIds = Array.from({ length: 4 }, (_, index) => `case_gold_${index + 1}`);
  validateReviewAssignments(JSON.parse(files["assignment.json"]), n, cardsPerReviewer, new Set([...inputs.config.case_ids, ...goldIds]));
  return { round, registrationCommit: git("log", "-1", "--format=%H", "origin/main", "--", "data/PREREGISTRATION.md").trim(),
    hashes: Object.fromEntries(REGISTERED_FILES.map(name => [name, sha256(files[name])])) };
}
