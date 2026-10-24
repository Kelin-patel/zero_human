import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CaseCard, Decision } from "./case-schema";
import { readFrozenBundle } from "./case-files";
import { canonicalJson, sha256 } from "./case-generation";
import { loadPolicy } from "./policy";
import { DeskDissent, DeskVote, type DeskResult } from "./refund-desk";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const PreparedConfig = z.object({
  schema_version: z.literal(1), scope: z.literal("frozen_dev_eval_cases_only"),
  agent_versions: z.array(z.enum(["v1", "v2"])), case_ids: z.array(z.string()).length(49),
  policy_sha256: Hash, cases_sha256: Hash,
  decision_options: z.object({ limits: z.object({ maxRefundCents: z.literal(19900) }).strict() }).strict(),
}).strict();
const VoteRecord = z.object({ stance: z.enum(["literal", "customer", "support"]), vote: DeskVote.nullable(), refused: z.boolean(), stopReason: z.string().nullable() });
export const BaselineEntry = z.object({
  case_id: z.string(), decision: Decision, clauses: z.array(z.string()), reason: z.string().min(1),
  votes: z.object({ round1: z.array(VoteRecord), round2: z.array(VoteRecord) }), dissent: DeskDissent.nullable(),
});
export type BaselineEntry = z.infer<typeof BaselineEntry>;

export function loadPreparedInputs() {
  const text = readFileSync(resolve("data/prepared-review.config.json"), "utf8");
  const config = PreparedConfig.parse(JSON.parse(text));
  const policy = loadPolicy();
  const { records, manifest } = readFrozenBundle();
  const selected = records.filter(record => record.set_name === "dev" || record.set_name === "eval");
  const wanted = [
    ...Array.from({ length: 22 }, (_, i) => `case_dev_${String(i + 1).padStart(2, "0")}`),
    ...Array.from({ length: 27 }, (_, i) => `case_eval_${String(i + 1).padStart(2, "0")}`),
  ];
  if (!config.agent_versions.includes("v1") || config.policy_sha256 !== policy.sha256 || config.cases_sha256 !== manifest.sha256["cases.frozen.json"] ||
      canonicalJson([...config.case_ids].sort()) !== canonicalJson([...wanted].sort()) ||
      canonicalJson(selected.map(record => record.card.id).sort()) !== canonicalJson([...wanted].sort())) {
    throw new Error("Prepared configuration, checksums or exact case IDs do not match the frozen inputs.");
  }
  // Only public cards cross into the decider. Gold and designer metadata are excluded.
  const cards = selected.map(record => CaseCard.parse(record.card)).sort((a, b) => a.id.localeCompare(b.id));
  const sourceSha256 = sha256(["src/lib/llm.ts", "src/lib/refund-desk.ts", "src/lib/prepared-baseline.ts", "scripts/run-agent.ts"]
    .map(file => readFileSync(resolve(file), "utf8").replace(/\r\n/g, "\n")).join("\n"));
  const configSha256 = sha256(text);
  return { config, configSha256, sourceSha256, policy, cards,
    fingerprint: sha256(canonicalJson({ configSha256, sourceSha256, model: "claude-opus-5-5", agentVersion: "v1" })) };
}

export function baselineEntry(caseId: string, result: DeskResult): BaselineEntry {
  return BaselineEntry.parse({ case_id: caseId, decision: result.decision, clauses: result.clauses,
    reason: result.reason, votes: result.votes, dissent: result.dissent });
}

export function validateBaseline(entries: unknown, caseIds: string[]): BaselineEntry[] {
  const parsed = z.array(BaselineEntry).length(49).parse(entries);
  if (new Set(parsed.map(entry => entry.case_id)).size !== 49 ||
      canonicalJson(parsed.map(entry => entry.case_id).sort()) !== canonicalJson([...caseIds].sort())) {
    throw new Error("Baseline must contain exactly the 49 configured cases, once each, with no gold cases.");
  }
  return parsed.sort((a, b) => a.case_id.localeCompare(b.case_id));
}

export async function runConcurrent<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency.");
  let index = 0;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length && !failure) {
      const item = items[index++];
      try { await work(item); } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
}
