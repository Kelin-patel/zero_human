import { CaseCard } from "../../src/lib/case-schema";
import type { TokenUsage } from "../../src/lib/llm";
import { decide, type DeskResult } from "../../src/lib/refund-desk";
import {
  appendLedger,
  enqueueJob,
  getCase,
  getDecision,
  getPolicy,
  hasDecision,
  insertDecision,
  setCaseStatus,
  type DecisionRow,
  type JobRow,
} from "../../src/lib/repo";

// The merchant's live per-case limit applies to customer and demo requests.
const LIVE_LIMITS = { maxRefundCents: 10000 };

// Standard USD rates per million tokens for claude-opus-5-5; an estimate for the ledger, not a bill.
const RATES_PER_MILLION = { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 };

function estimatedCostCents(usage: TokenUsage): number {
  const usd = Object.entries(RATES_PER_MILLION).reduce(
    (sum, [key, rate]) => sum + ((usage[key as keyof TokenUsage] ?? 0) * rate) / 1_000_000,
    0,
  );
  return Math.round(usd * 100);
}

/** Makes the Refund Desk's first decision on a customer or demo request. */
export async function decideCase(job: JobRow): Promise<void> {
  const caseId = job.case_id ?? (job.payload as { caseId?: string } | null)?.caseId;
  if (!caseId) throw new Error(`decide job ${job.id} has no case`);
  const stored = await getCase(caseId);
  if (!stored) throw new Error(`case ${caseId} not found`);
  // Prepared evaluation cases are decided only by the frozen batch runs, never here.
  if (stored.set_name !== "demo" && stored.set_name !== "live") throw new Error(`case ${caseId} is not a customer request`);
  const env = stored.set_name === "demo" ? "sandbox" : "live";

  // A retry after a crash must not pay for the model calls twice.
  if (stored.status === "new" && !(await hasDecision(caseId, "live"))) {
    if (stored.policyId == null) throw new Error(`case ${caseId} has no policy`);
    const policy = await getPolicy(stored.policyId);
    if (!policy) throw new Error(`policy ${stored.policyId} not found`);

    let row: DecisionRow;
    let costCents = 0;
    try {
      const result: DeskResult = await decide(CaseCard.parse(stored.card), policy, { limits: LIVE_LIMITS });
      costCents = estimatedCostCents(result.usage);
      row = {
        caseId,
        agentVersion: "live",
        decision: result.decision,
        clauses: result.clauses,
        reason: result.reason,
        votes: result.votes,
        dissent: result.dissent,
        policySha256: result.policySha256,
        notesVersion: result.notesVersion,
        meta: { usage: result.usage, latencyMs: result.latencyMs, calls: result.calls.length, costCents },
      };
    } catch (err) {
      // Retry once; after that, hand the request to people instead of guessing.
      if (job.attempts < 2) throw err;
      row = {
        caseId,
        agentVersion: "live",
        decision: "out_of_scope",
        clauses: [],
        reason: "The automated desk was unavailable, so this request needs a person to decide it.",
        meta: { error: err instanceof Error ? err.name : "unknown" },
      };
    }

    if (await insertDecision(row)) {
      await appendLedger({
        actor: "refund_desk",
        decision: row.decision,
        reason: row.reason,
        costCents,
        meta: { env, caseId, setName: stored.set_name, clauses: row.clauses },
      });
    }
    console.log(`decide: ${caseId} -> ${row.decision} (${costCents} cents)`);
  }

  // An approval on a request with a real payment is carried out by the executor, within the merchant's limits.
  // Outside the block above so a retry after a crash still queues it, exactly once.
  if (stored.whopPaymentId) {
    const live = await getDecision(caseId, "live");
    if (live?.decision === "approve") {
      const finalized = await insertDecision({
        caseId,
        agentVersion: "final",
        decision: "approve",
        clauses: live.clauses,
        reason: `approved by the AI support desk under ${live.clauses.join(", ") || "the store's policy"}`,
        votes: { source: "ai_desk" },
      });
      if (finalized) await enqueueJob("execute", { caseId });
    }
  }
  // Never move an appealed or resolved case back.
  if (stored.status === "new") await setCaseStatus(caseId, "decided");
}
