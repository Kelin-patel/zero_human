import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { canonicalJson, sha256 } from "../src/lib/case-generation";
import { CaseCard } from "../src/lib/case-schema";
import { getSql } from "../src/lib/db";
import { LEARNER_DRY_RUN_FILE } from "../src/lib/learner";
import { MODEL, type TokenUsage } from "../src/lib/llm";
import { BaselineEntry, baselineEntry, loadPreparedInputs, runConcurrent, validateBaseline } from "../src/lib/prepared-baseline";
import { decide, type DeskResult } from "../src/lib/refund-desk";

loadEnvConfig(process.cwd());
const output = resolve("data/decisions_v2.json");
const reportPath = resolve(".baseline-runs/v2-report.json");
const lock = resolve(".baseline-runs/v2.lock");
const USAGE = "Usage: npm run agent:run -- --version v2 --set eval [--check | --dry-run [--limit N]]";

function parseArgs(argv: string[]) {
  if (argv[0] !== "--version" || argv[1] !== "v2" || argv[2] !== "--set" || argv[3] !== "eval") throw new Error(USAGE);
  const rest = argv.slice(4);
  const check = rest.includes("--check");
  const dryRun = rest.includes("--dry-run");
  const limitAt = rest.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(rest[limitAt + 1]) : 2;
  const known = rest.filter((arg, i) => ["--check", "--dry-run", "--limit"].includes(arg) || (i > 0 && rest[i - 1] === "--limit"));
  if (known.length !== rest.length || (check && dryRun) || (limitAt >= 0 && !dryRun) || !Number.isSafeInteger(limit) || limit < 1) throw new Error(USAGE);
  return { check, dryRun, limit };
}

function validateV2(entries: unknown, caseIds: string[]): BaselineEntry[] {
  const parsed = z.array(BaselineEntry).length(caseIds.length).parse(entries);
  if (canonicalJson(parsed.map(entry => entry.case_id).sort()) !== canonicalJson([...caseIds].sort())) {
    throw new Error("v2 output must contain exactly the configured evaluation cases, once each.");
  }
  return parsed.sort((a, b) => a.case_id.localeCompare(b.case_id));
}

async function main() {
  const { check, dryRun, limit } = parseArgs(process.argv.slice(2));
  const inputs = loadPreparedInputs();
  if (!inputs.config.agent_versions.includes("v2")) throw new Error("The prepared configuration does not cover v2.");
  // The frozen baseline must still verify; v2 is only meaningful against it.
  validateBaseline(JSON.parse(readFileSync(resolve("data/decisions_v1.json"), "utf8")), inputs.config.case_ids);
  const cards = inputs.cards.filter(card => card.id.startsWith("case_eval_"));
  const ids = cards.map(card => card.id);
  if (ids.length !== 27) throw new Error("Expected the 27 frozen evaluation cases.");
  const sql = getSql();

  // Notes come from the single stored v2 learner run, or from a local dry-run file when rehearsing.
  let notes: { id: number | null; text: string; sha256: string };
  if (dryRun) {
    if (!existsSync(LEARNER_DRY_RUN_FILE)) throw new Error("Run `npm run learn -- --dry-run --include-test` first.");
    const local = JSON.parse(readFileSync(LEARNER_DRY_RUN_FILE, "utf8")) as { notesText: string };
    notes = { id: null, text: local.notesText, sha256: sha256(local.notesText) };
  } else {
    const rows = await sql`SELECT id, notes, source_case_ids FROM agent_notes WHERE version = 'v2' ORDER BY id`;
    if (rows.length !== 1) throw new Error(`Expected exactly one v2 notes row, found ${rows.length}. Run \`npm run learn\` first.`);
    const sources: string[] = rows[0].source_case_ids ?? [];
    if (sources.length) {
      const sets = await sql`SELECT id, set_name FROM cases WHERE id = ANY(${sources}::text[])`;
      if (sets.length !== sources.length || sets.some(row => row.set_name !== "dev")) throw new Error("v2 notes cite a non-development case.");
    }
    notes = { id: Number(rows[0].id), text: rows[0].notes, sha256: sha256(rows[0].notes) };
  }
  const sourceSha256 = sha256(["src/lib/llm.ts", "src/lib/refund-desk.ts", "src/lib/prepared-baseline.ts", "scripts/run-agent-v2.ts"]
    .map(file => readFileSync(resolve(file), "utf8").replace(/\r\n/g, "\n")).join("\n"));
  const fingerprint = sha256(canonicalJson({ configSha256: inputs.configSha256, sourceSha256, model: MODEL, agentVersion: "v2", notesSha256: notes.sha256, notesId: notes.id }));
  const options = { ...inputs.config.decision_options, notes: notes.text || undefined };

  const readDecisions = () => sql`SELECT case_id, decision, clauses, reason, votes, dissent, policy_sha256, meta FROM decisions
    WHERE agent_version = 'v2' AND case_id = ANY(${ids}::text[]) ORDER BY case_id`;
  function decode(rows: Awaited<ReturnType<typeof readDecisions>>) {
    for (const row of rows) {
      if (row.policy_sha256 !== inputs.policy.sha256 || row.meta?.inputFingerprint !== fingerprint) {
        throw new Error("Existing v2 decisions have different inputs, notes or source code. They will not be overwritten.");
      }
    }
    return rows.map(row => ({ case_id: row.case_id, decision: row.decision, clauses: row.clauses, reason: row.reason, votes: row.votes, dissent: row.dissent }));
  }

  if (check) {
    const text = readFileSync(output, "utf8");
    const frozen = validateV2(JSON.parse(text), ids);
    if (canonicalJson(frozen) !== text || canonicalJson(validateV2(decode(await readDecisions()), ids)) !== text) {
      throw new Error("decisions_v2.json does not exactly match the canonical database decisions.");
    }
    console.log(canonicalJson({ verified: frozen.length, sha256: sha256(text), notesSha256: notes.sha256, policySha256: inputs.policy.sha256 }));
    return;
  }

  if (dryRun) {
    console.log(`[v2 dry run] notes sha=${notes.sha256.slice(0, 12)}; deciding ${Math.min(limit, cards.length)} evaluation cards; nothing is stored`);
    const usage: TokenUsage = { input: 0, output: 0 };
    for (const card of cards.slice(0, limit)) {
      const result = await decide(card, inputs.policy, options);
      usage.input += result.usage.input;
      usage.output += result.usage.output;
      console.log(`[v2 dry run] ${card.id}: ${result.decision} (${result.clauses.join(", ")}) notes=${result.notesVersion} latency=${result.latencyMs}ms in=${result.usage.input} out=${result.usage.output}`);
    }
    console.log(canonicalJson({ cards: Math.min(limit, cards.length), usage, estimatedUsd: (4 * usage.input + 20 * usage.output) / 1_000_000 }));
    return;
  }

  // v2 runs only after the protocol is registered publicly and never overwrites a published output.
  if (spawnSync("git", ["fetch", "origin", "main"], { stdio: "ignore", windowsHide: true }).status !== 0) {
    throw new Error("Could not refresh origin/main; cannot confirm the registered protocol.");
  }
  if (spawnSync("git", ["cat-file", "-e", "origin/main:data/PREREGISTRATION.md"], { stdio: "ignore", windowsHide: true }).status !== 0) {
    throw new Error("The evaluation protocol is not registered on origin/main.");
  }
  if (existsSync(output)) throw new Error("data/decisions_v2.json already exists. Use --check; v2 will not run again.");
  const stored = await sql`SELECT id, facts, policy_id, set_name FROM cases WHERE id = ANY(${ids}::text[])`;
  const cardById = new Map(cards.map(card => [card.id, card]));
  const policies = await sql`SELECT id, text FROM policies WHERE sha256 = ${inputs.policy.sha256}`;
  const policyIds = new Set(policies.filter(policy => policy.text.replace(/\r\n/g, "\n") === inputs.policy.text).map(policy => Number(policy.id)));
  if (stored.length !== ids.length) throw new Error("Database must contain all 27 evaluation cases.");
  for (const row of stored) {
    if (!policyIds.has(Number(row.policy_id)) || row.set_name !== "eval" || canonicalJson(CaseCard.parse(row.facts)) !== canonicalJson(cardById.get(row.id))) {
      throw new Error("A stored evaluation case differs from the frozen public card.");
    }
  }

  mkdirSync(".baseline-runs", { recursive: true });
  writeFileSync(lock, canonicalJson({ pid: process.pid, inputFingerprint: fingerprint }), { flag: "wx" });
  try {
    const existing = await readDecisions();
    decode(existing);
    const recorded = new Set(existing.map(row => String(row.case_id)));
    const pending = cards.filter(card => !recorded.has(card.id));
    console.log(`[v2] ${recorded.size} recorded; ${pending.length} pending; concurrency=5; limit=${options.limits.maxRefundCents}; notes sha=${notes.sha256.slice(0, 12)}`);
    await runConcurrent(pending, 5, async card => {
      let result: DeskResult | undefined;
      let failedUsage: TokenUsage = { input: 0, output: 0 };
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { result = await decide(card, inputs.policy, options); break; }
        catch (error) {
          if (error && typeof error === "object" && "calls" in error && Array.isArray(error.calls)) {
            failedUsage = error.calls.reduce((sum, call) => ({ input: sum.input + (call.usage?.input ?? 0), output: sum.output + (call.usage?.output ?? 0) }), failedUsage);
          }
          console.warn(`[v2] ${card.id} attempt=${attempt} failed (${error instanceof Error ? error.name : "unknown"})`);
          if (attempt === 2) throw error;
        }
      }
      if (!result) throw new Error("No v2 result returned.");
      const entry = baselineEntry(card.id, result);
      const meta = { inputFingerprint: fingerprint, configSha256: inputs.configSha256, sourceSha256, notesSha256: notes.sha256,
        agentNotesId: notes.id, model: MODEL, usage: result.usage, failedUsage, latencyMs: result.latencyMs, calls: result.calls,
        decisionOptions: inputs.config.decision_options };
      const estimatedUsd = (4 * (result.usage.input + failedUsage.input) + 20 * (result.usage.output + failedUsage.output)) / 1_000_000;
      // Decision and audit entry are committed atomically. A resumed run cannot book the same decision twice.
      await sql`
        WITH recorded AS (
          INSERT INTO decisions (case_id, agent_version, decision, clauses, reason, votes, dissent, policy_sha256, notes_version, meta)
          VALUES (${card.id}, 'v2', ${entry.decision}, ${entry.clauses}, ${entry.reason}, ${JSON.stringify(entry.votes)}::jsonb,
                  ${JSON.stringify(entry.dissent)}::jsonb, ${inputs.policy.sha256}, 'v2', ${JSON.stringify(meta)}::jsonb)
          ON CONFLICT (case_id, agent_version) DO NOTHING RETURNING case_id
        )
        INSERT INTO ledger (actor, decision, reason, cost_cents, meta, env)
        SELECT 'refund_desk', ${entry.decision}, ${entry.reason}, ${Math.ceil(estimatedUsd * 100)},
               ${JSON.stringify({ caseId: card.id, agentVersion: "v2", estimatedUsd, ...meta })}::jsonb, 'sandbox' FROM recorded`;
      console.log(`[v2] ${card.id}: ${entry.decision}; in=${result.usage.input} out=${result.usage.output}`);
    });
    const rows = await readDecisions();
    const entries = validateV2(decode(rows), ids);
    const text = canonicalJson(entries);
    const usage = rows.reduce((sum, row) => ({
      input: sum.input + row.meta.usage.input + (row.meta.failedUsage?.input ?? 0),
      output: sum.output + row.meta.usage.output + (row.meta.failedUsage?.output ?? 0),
    }), { input: 0, output: 0 });
    const counts = Object.fromEntries(["approve", "deny", "out_of_scope"].map(decision => [decision, entries.filter(entry => entry.decision === decision).length]));
    const report = { count: entries.length, counts, usage, estimatedUsd: (usage.input * 4 + usage.output * 20) / 1_000_000,
      ratesUsdPerMillion: { input: 4, output: 20 }, sha256: sha256(text), notesSha256: notes.sha256, agentNotesId: notes.id,
      configSha256: inputs.configSha256, policySha256: inputs.policy.sha256, sourceSha256, inputFingerprint: fingerprint,
      recordedAt: new Date().toISOString() };
    writeFileSync(reportPath, canonicalJson(report));
    const temporary = resolve(".baseline-runs/decisions_v2.json");
    writeFileSync(temporary, text);
    linkSync(temporary, output); // Cannot overwrite an already published v2 output.
    console.log(canonicalJson(report));
  } finally { unlinkSync(lock); }
}

main().catch(error => {
  console.error("v2 run stopped:", error instanceof Error ? error.message.replace(/(?:https?:\/\/|postgres\w*:\/\/)\S+/g, "[URL redacted]") : "unknown failure");
  process.exitCode = 1;
});
