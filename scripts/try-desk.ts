import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CaseCard, Decision } from "../src/lib/case-schema";
import { loadPolicy } from "../src/lib/policy";
import { decide, type DeskResult } from "../src/lib/refund-desk";

loadEnvConfig(process.cwd());

// Standard USD rates checked on 2026-10-24; an estimate, not a billing statement.
// Source: https://platform.claude.com/docs/en/about-claude/pricing
const ratesPerMillion = { input: 4, output: 20, cacheRead: 0.20, cacheWrite5m: 5, cacheWrite1h: 8 };
function estimatedUsd(result: DeskResult): number | null {
  if (result.calls.some(call => call.models.length === 0 || call.models.some(model => !model.startsWith("claude-opus-5-5")))) return null;
  return Object.entries(ratesPerMillion).reduce((sum, [key, rate]) => sum + (result.usage[key as keyof typeof ratesPerMillion] ?? 0) * rate / 1_000_000, 0);
}

async function main() {
  const policy = loadPolicy();
  const fixtures = z.array(z.object({ expected: Decision, card: CaseCard })).length(4)
    .parse(JSON.parse(readFileSync(resolve("scripts/fixtures/sample-cases.json"), "utf8")));
  const report: { at: string; policySha256: string; ratesPerMillion: typeof ratesPerMillion; results: unknown[] } = {
    at: new Date().toISOString(), policySha256: policy.sha256, ratesPerMillion, results: [],
  };
  mkdirSync(".desk-checks", { recursive: true });
  let failures = 0;
  for (const fixture of fixtures) {
    const result = await decide(fixture.card, policy);
    const passed = result.decision === fixture.expected;
    if (!passed) failures++;
    const usd = estimatedUsd(result);
    const row = { id: fixture.card.id, expected: fixture.expected, passed, estimatedUsd: usd, ...result };
    report.results.push(row);
    writeFileSync(".desk-checks/report.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(row, null, 2));
  }
  const card = fixtures[0].card;
  for (const outside of [
    { ...card, price_usd: 100.01 },
    { ...card, records: { ...card.records, disputed: true } },
    { ...card, customer_statement: "My attorney has filed a lawsuit." },
  ]) {
    const result = await decide(outside, policy);
    assert.equal(result.decision, "out_of_scope");
    assert.equal(result.calls.length, 0);
  }
  console.log(`Fixtures: ${4 - failures}/4 passed; amount, dispute and legal pre-checks passed without LLM calls.`);
  console.log("Usage, latency and cost estimates saved to .desk-checks/report.json");
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error("Desk check failed:", error instanceof Error ? error.name : "unknown error");
  process.exitCode = 1;
});
