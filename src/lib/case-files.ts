import { CaseDataError } from "./case-error";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { CaseRecord } from "./case-schema";
import { canonicalJson, CASE_SEED, Candidate, consistencyIssues, selectCases, sha256 } from "./case-generation";
import { goldCases } from "./gold-cases";
import { loadPolicy } from "./policy";

const DATA_FILES = ["cases.candidates.json", "cases.frozen.json", "gold-cases.json"] as const;
const MANIFEST = "cases.manifest.json";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Manifest = z.object({
  seed: z.literal(CASE_SEED),
  base_url: z.string().url(),
  policy_sha256: Hash,
  sha256: z.object({ "cases.candidates.json": Hash, "cases.frozen.json": Hash, "gold-cases.json": Hash }),
});

export function assertNoFrozenBundle(): void {
  if ([...DATA_FILES, MANIFEST].some(name => existsSync(resolve("data", name)))) {
    throw new CaseDataError("Case data already exists. It will not be overwritten. Use --check or --seed-only.");
  }
}

export function writeFrozenBundle(candidates: Candidate[], baseUrl: string, usage: unknown) {
  assertNoFrozenBundle();
  const selection = selectCases(candidates, baseUrl);
  const gold = goldCases(baseUrl);
  for (const record of gold) {
    const issues = consistencyIssues({ card: record.card, hidden: { category: "C1", designer_clause: "§1", designer_intent: record.expected!.decision } }, baseUrl, true);
    if (issues.length) throw new CaseDataError(`Invalid gold card ${record.card.id}: ${issues.join("; ")}`);
  }
  const frozen = [...selection.records, ...gold];
  const contents = {
    "cases.candidates.json": canonicalJson(candidates),
    "cases.frozen.json": canonicalJson(frozen),
    "gold-cases.json": canonicalJson(gold),
  };
  const hashes = Object.fromEntries(DATA_FILES.map(name => [name, sha256(contents[name])]));
  const manifest = {
    seed: CASE_SEED,
    algorithm: "mulberry32; largest remainder with category-order tie breaking; Fisher-Yates shuffle",
    base_url: baseUrl,
    policy_sha256: loadPolicy().sha256,
    sha256: hashes,
    counts: { candidates: 70, dev: 22, eval: 27, gold: 4 },
    category_counts: selection.categoryCounts,
    rejected: selection.rejected,
    candidate_to_case: selection.assignments,
    generation: usage,
  };
  mkdirSync(resolve("data"), { recursive: true });
  const temporary = mkdtempSync(resolve("data", ".case-generation-"));
  const published: string[] = [];
  try {
    const files = { ...contents, [MANIFEST]: canonicalJson(manifest) };
    for (const [name, text] of Object.entries(files)) {
      const temporaryFile = join(temporary, name);
      writeFileSync(temporaryFile, text, { encoding: "utf8", flag: "wx" });
      const destination = resolve("data", name);
      // A hard link atomically creates a new file and cannot replace a frozen one.
      linkSync(temporaryFile, destination);
      published.push(destination);
    }
  } catch (error) {
    for (const path of published) rmSync(path);
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return { frozen, manifest, selection };
}

export function readFrozenBundle(): { records: CaseRecord[]; manifest: z.infer<typeof Manifest> } {
  const manifest = Manifest.parse(JSON.parse(readFileSync(resolve("data", MANIFEST), "utf8")));
  if (loadPolicy().sha256 !== manifest.policy_sha256) throw new CaseDataError("Frozen policy checksum changed.");
  const parsed: Record<string, unknown> = {};
  for (const name of DATA_FILES) {
    const text = readFileSync(resolve("data", name), "utf8");
    if (sha256(text) !== manifest.sha256[name]) throw new CaseDataError(`Checksum mismatch: ${name}`);
    parsed[name] = JSON.parse(text);
    if (canonicalJson(parsed[name]) !== text) throw new CaseDataError(`Noncanonical JSON: ${name}`);
  }
  const candidates = z.array(Candidate).length(70).parse(parsed["cases.candidates.json"]);
  const records = z.array(CaseRecord).length(53).parse(parsed["cases.frozen.json"]);
  const gold = goldCases(manifest.base_url);
  const selection = selectCases(candidates, manifest.base_url);
  if (canonicalJson(gold) !== canonicalJson(parsed["gold-cases.json"]) ||
      canonicalJson([...selection.records, ...gold]) !== canonicalJson(records)) {
    throw new CaseDataError("Frozen cards differ from the deterministic selection or gold cards.");
  }
  return { records, manifest };
}
