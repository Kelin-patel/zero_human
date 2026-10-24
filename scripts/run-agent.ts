import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, sha256 } from "../src/lib/case-generation";
import { CaseCard } from "../src/lib/case-schema";
import { getSql } from "../src/lib/db";
import { MODEL, type TokenUsage } from "../src/lib/llm";
import { baselineEntry, loadPreparedInputs, runConcurrent, validateBaseline } from "../src/lib/prepared-baseline";
import { decide, type DeskResult } from "../src/lib/refund-desk";

loadEnvConfig(process.cwd());
const output = resolve("data/decisions_v1.json");
const reportPath = resolve(".baseline-runs/v1-report.json");
const lock = resolve(".baseline-runs/v1.lock");

function remoteHasRegistration(): boolean {
  return spawnSync("git", ["cat-file", "-e", "origin/main:data/PREREGISTRATION.md"], { stdio: "ignore", windowsHide: true }).status === 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "--version" || args[1] !== "v1" || args.slice(2).some(arg => arg !== "--check")) {
    throw new Error("Usage: npm run agent:run -- --version v1 [--check]");
  }
  const check = args.includes("--check");
  const inputs = loadPreparedInputs();
  const sql = getSql();
  const ids = inputs.config.case_ids;
  const readDecisions = () => sql`SELECT case_id, decision, clauses, reason, votes, dissent, policy_sha256, meta FROM decisions WHERE agent_version = 'v1' AND case_id = ANY(${ids}::text[]) ORDER BY case_id`;
  function decode(rows: Awaited<ReturnType<typeof readDecisions>>) {
    for (const row of rows) {
      if (row.policy_sha256 !== inputs.policy.sha256 || row.meta?.inputFingerprint !== inputs.fingerprint) {
        throw new Error("Existing v1 decisions have different inputs or source code. They will not be overwritten.");
      }
    }
    return rows.map(row => ({ case_id: row.case_id, decision: row.decision, clauses: row.clauses,
      reason: row.reason, votes: row.votes, dissent: row.dissent }));
  }
  if (check) {
    const text = readFileSync(output, "utf8");
    const frozen = validateBaseline(JSON.parse(text), ids);
    if (canonicalJson(frozen) !== text || canonicalJson(validateBaseline(decode(await readDecisions()), ids)) !== text) {
      throw new Error("Frozen baseline does not exactly match canonical database decisions.");
    }
    console.log(canonicalJson({ verified: frozen.length, sha256: sha256(text), policySha256: inputs.policy.sha256, casesSha256: inputs.config.cases_sha256 }));
    return;
  }
  // Refresh the remote gate before spending tokens or recording any new baseline decision.
  if (spawnSync("git", ["fetch", "origin", "main"], { stdio: "ignore", windowsHide: true }).status !== 0) {
    throw new Error("Could not refresh origin/main; cannot verify that baseline recording is still open.");
  }
  if (existsSync(output) || existsSync("data/PREREGISTRATION.md") || remoteHasRegistration()) {
    throw new Error("The baseline is already frozen or registered. Use --check; v1 will not run again.");
  }
  const [activity] = await sql`SELECT count(*)::int AS count FROM reviews
    WHERE case_id ~ '^case_(dev|eval|gold)_' AND terac_submission_id NOT LIKE 'test\\_%' ESCAPE '\\'
      AND (to_jsonb(reviews)->>'is_test')::boolean IS NOT TRUE`;
  if (activity.count > 0) throw new Error("Human collection has begun; baseline recording is closed.");
  const stored = await sql`SELECT id, facts, policy_id, set_name FROM cases WHERE id = ANY(${ids}::text[])`;
  if (stored.length !== 49) throw new Error("Database must contain all 49 prepared cases first.");
  const cards = new Map(inputs.cards.map(card => [card.id, card]));
  const policies = await sql`SELECT id, text, sha256 FROM policies WHERE sha256 = ${inputs.policy.sha256}`;
  const policyIds = new Set(policies.filter(policy => policy.text.replace(/\r\n/g, "\n") === inputs.policy.text).map(policy => Number(policy.id)));
  for (const row of stored) {
    if (!policyIds.has(Number(row.policy_id)) || !["dev", "eval"].includes(row.set_name) || canonicalJson(CaseCard.parse(row.facts)) !== canonicalJson(cards.get(row.id))) {
      throw new Error("A stored case differs from the frozen public card.");
    }
  }
  mkdirSync(".baseline-runs", { recursive: true });
  writeFileSync(lock, canonicalJson({ pid: process.pid, inputFingerprint: inputs.fingerprint }), { flag: "wx" });
  try {
    const existing = await readDecisions();
    decode(existing);
    const recorded = new Set(existing.map(row => String(row.case_id)));
    const pending = inputs.cards.filter(card => !recorded.has(card.id));
    console.log(`[baseline] ${recorded.size} recorded; ${pending.length} pending; concurrency=4; limit=${inputs.config.decision_options.limits.maxRefundCents}`);
    await runConcurrent(pending, 4, async card => {
      let result: DeskResult | undefined;
      let failedUsage: TokenUsage = { input: 0, output: 0 };
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { result = await decide(card, inputs.policy, inputs.config.decision_options); break; }
        catch (error) {
          if (error && typeof error === "object" && "calls" in error && Array.isArray(error.calls)) {
            failedUsage = error.calls.reduce((sum, call) => ({ input: sum.input + (call.usage?.input ?? 0), output: sum.output + (call.usage?.output ?? 0) }), failedUsage);
          }
          console.warn(`[baseline] ${card.id} attempt=${attempt} failed (${error instanceof Error ? error.name : "unknown"})`);
          if (attempt === 2) throw error;
        }
      }
      if (!result) throw new Error("No baseline result returned.");
      const entry = baselineEntry(card.id, result);
      const meta = { inputFingerprint: inputs.fingerprint, configSha256: inputs.configSha256,
        sourceSha256: inputs.sourceSha256, model: MODEL, usage: result.usage, failedUsage,
        latencyMs: result.latencyMs, calls: result.calls, decisionOptions: inputs.config.decision_options };
      const estimatedUsd = (4 * (result.usage.input + failedUsage.input) + 20 * (result.usage.output + failedUsage.output)) / 1_000_000;
      // Decision and audit entry are committed atomically. A resumed run cannot book the same decision twice.
      await sql`
        WITH recorded AS (
          INSERT INTO decisions (case_id, agent_version, decision, clauses, reason, votes, dissent, policy_sha256, notes_version, meta)
          VALUES (${card.id}, 'v1', ${entry.decision}, ${entry.clauses}, ${entry.reason}, ${JSON.stringify(entry.votes)}::jsonb,
                  ${JSON.stringify(entry.dissent)}::jsonb, ${inputs.policy.sha256}, 'v1', ${JSON.stringify(meta)}::jsonb)
          ON CONFLICT (case_id, agent_version) DO NOTHING RETURNING case_id
        )
        INSERT INTO ledger (actor, decision, reason, cost_cents, meta, env)
        SELECT 'refund_desk', ${entry.decision}, ${entry.reason}, ${Math.ceil(estimatedUsd * 100)},
               ${JSON.stringify({ caseId: card.id, agentVersion: "v1", estimatedUsd, ...meta })}::jsonb, 'sandbox' FROM recorded`;
      console.log(`[baseline] ${card.id}: ${entry.decision}; in=${result.usage.input} out=${result.usage.output}`);
    });
    const rows = await readDecisions();
    const entries = validateBaseline(decode(rows), ids);
    const text = canonicalJson(entries);
    const usage = rows.reduce((sum, row) => ({
      input: sum.input + row.meta.usage.input + (row.meta.failedUsage?.input ?? 0),
      output: sum.output + row.meta.usage.output + (row.meta.failedUsage?.output ?? 0),
    }), { input: 0, output: 0 });
    const counts = Object.fromEntries(["approve", "deny", "out_of_scope"].map(decision => [decision, entries.filter(entry => entry.decision === decision).length]));
    const report = { count: entries.length, counts, usage, estimatedUsd: (usage.input * 4 + usage.output * 20) / 1_000_000,
      ratesUsdPerMillion: { input: 4, output: 20 }, pricingSource: "https://platform.claude.com/docs/en/about-claude/pricing",
      sha256: sha256(text), configSha256: inputs.configSha256, policySha256: inputs.policy.sha256,
      casesSha256: inputs.config.cases_sha256, sourceSha256: inputs.sourceSha256, inputFingerprint: inputs.fingerprint,
      recordedAt: new Date().toISOString(), rows: rows.map(row => ({ caseId: row.case_id, ...row.meta })) };
    writeFileSync(reportPath, canonicalJson(report));
    const temporary = resolve(".baseline-runs/decisions_v1.json");
    writeFileSync(temporary, text);
    linkSync(temporary, output); // Cannot overwrite an already published baseline.
    console.log(canonicalJson({ ...report, rows: undefined }));
  } finally { unlinkSync(lock); }
}

main().catch(error => {
  console.error("Baseline run stopped:", error instanceof Error ? error.message.replace(/(?:https?:\/\/|postgres\w*:\/\/)\S+/g, "[URL redacted]") : "unknown failure");
  process.exitCode = 1;
});
