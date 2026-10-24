import { loadEnvConfig } from "@next/env";
import { closeSync, openSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { assertNoFrozenBundle, readFrozenBundle, writeFrozenBundle } from "../src/lib/case-files";
import { canonicalJson, normalizeBaseUrl } from "../src/lib/case-generation";
import { CaseDataError } from "../src/lib/case-error";
import { assertCollectionNotStarted, seedFrozenCases } from "../src/lib/case-seed";
import { loadPolicy } from "../src/lib/policy";
import { generateCandidates } from "./lib/generate-candidates";

async function main() {
  const flags = process.argv.slice(2);
  if (flags.includes("--help")) {
    console.log("Usage: tsx scripts/gen-cases.ts [--generate-only | --seed-only | --check]\nDefault: generate, freeze, then seed. Existing files are never overwritten.");
    return;
  }
  if (flags.length > 1 || flags.some(flag => !["--generate-only", "--seed-only", "--check"].includes(flag))) {
    throw new CaseDataError("Use one of --generate-only, --seed-only, or --check, or no flags.");
  }
  loadEnvConfig(process.cwd());
  if (flags.includes("--check")) {
    const { records, manifest } = readFrozenBundle();
    console.log(canonicalJson({ verified: records.length, policySha256: manifest.policy_sha256, casesSha256: manifest.sha256["cases.frozen.json"] }).trim());
    return;
  }
  if (!flags.includes("--generate-only") && !process.env.DATABASE_URL?.trim()) {
    throw new CaseDataError("Set DATABASE_URL in .env.local, or use --generate-only to freeze files before database seeding.");
  }
  if (flags.includes("--seed-only")) {
    console.log(canonicalJson(await seedFrozenCases()).trim());
    return;
  }
  assertNoFrozenBundle();
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new CaseDataError("Set ANTHROPIC_API_KEY in .env.local.");
  if (!process.env.APP_BASE_URL?.trim()) throw new CaseDataError("Set APP_BASE_URL to the deployed application origin.");
  const baseUrl = normalizeBaseUrl(process.env.APP_BASE_URL.trim());
  if (process.env.DATABASE_URL?.trim()) await assertCollectionNotStarted();
  const lock = resolve(".case-generation.lock");
  let descriptor: number;
  try {
    descriptor = openSync(lock, "wx", 0o600);
  } catch {
    throw new CaseDataError("Another generator may be running (.case-generation.lock exists). Do not start a second run.");
  }
  try {
    const policy = loadPolicy();
    const { candidates, generation } = await generateCandidates(policy.text, baseUrl);
    const { manifest, selection } = writeFrozenBundle(candidates, baseUrl, generation);
    for (const rejected of selection.rejected) console.log(`Dropped ${rejected.id}: ${rejected.reasons.join("; ")}`);
    console.log(canonicalJson({ candidates: 70, dev: 22, eval: 27, gold: 4, policySha256: manifest.policy_sha256, sha256: manifest.sha256, categories: selection.categoryCounts }).trim());
    if (!flags.includes("--generate-only")) console.log(canonicalJson(await seedFrozenCases()).trim());
  } finally {
    closeSync(descriptor);
    rmSync(lock);
  }
}

void main().catch((error: unknown) => {
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? ` (HTTP ${error.status})` : "";
  console.error(error instanceof CaseDataError ? error.message : `Case generation/seeding failed${status}. Check API access, configuration, database migration, and the saved data. Provider errors are suppressed to protect credentials.`);
  process.exitCode = 1;
});
