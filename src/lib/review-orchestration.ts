import { getSql } from "./db";
import { type JobKind, type JobRow } from "./repo";
import { object, opportunityObject, parseOpportunity, readSubmissionStatuses, STOP_AT, submissionStatuses } from "./terac-data";
import { runTerac } from "./terac-headless";
import { readFileSync } from "node:fs";
import { sha256 } from "./case-generation";
import { Assignment } from "./task-assignment";
import { completedReviewerIds } from "./review-completion";

// Live appeals wait for their own orchestrator instead of being consumed by evaluation polling.
export async function claimReviewWorkerJob(kinds: JobKind[]): Promise<JobRow | null> {
  if (!kinds.length) return null;
  const sql = getSql();
  const [row] = await sql`UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = now()
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() AND kind = ANY(${kinds})
      AND (kind <> 'review' OR payload->>'purpose' = 'eval_round') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
  return row as JobRow | undefined ?? null;
}

export async function pauseReview(teracJobId: number, reason: string): Promise<void> {
  const sql = getSql();
  const [row] = await sql`SELECT * FROM terac_jobs WHERE id = ${teracJobId} AND purpose = 'eval_round'`;
  if (!row) throw new Error("Unknown evaluation opportunity.");
  if (["paused", "completed"].includes(row.status)) return;
  if (!["launched", "pause_unknown", "pausing"].includes(row.status)) throw new Error("This opportunity is not known to be launched.");
  const id = String(row.opportunity_id);
  // Read first to reconcile a previously interrupted pause without repeating a mutation blindly.
  const inspected = await runTerac(`Call terac_get_opportunity for opportunity_id=${JSON.stringify(id)}. Return {"opportunity": raw_response}.`, ["terac_get_opportunity"]);
  let opportunity = opportunityObject(inspected.response.opportunity);
  if ((opportunity.id ?? opportunity.opportunity_id) !== id) throw new Error("Terac returned a different opportunity.");
  if (!["paused", "stopped", "closed", "completed", "fulfilled", "expired", "cancelled"].includes(String(opportunity.status))) {
    if (opportunity.status !== "active") throw new Error("Terac opportunity status does not permit pausing.");
    const claimed = await sql`UPDATE terac_jobs SET status = 'pausing' WHERE id = ${teracJobId} AND status IN ('launched', 'pause_unknown', 'pausing') RETURNING id`;
    if (!claimed.length) return;
    try {
      const result = await runTerac(`Pause only opportunity_id=${JSON.stringify(id)} with terac_pause_opportunity, then read it with terac_get_opportunity.
Return {"opportunity": raw_get_opportunity_response}. Do not launch, approve or reject participants.`, ["terac_pause_opportunity", "terac_get_opportunity"]);
      opportunity = opportunityObject(result.response.opportunity);
      if ((opportunity.id ?? opportunity.opportunity_id) !== id || !["paused", "stopped", "closed", "completed", "fulfilled"].includes(String(opportunity.status))) {
        throw new Error("Terac has not confirmed that recruitment is paused.");
      }
    } catch (error) { await sql`UPDATE terac_jobs SET status = 'pause_unknown' WHERE id = ${teracJobId}`; throw error; }
  }
  await sql`WITH paused AS (UPDATE terac_jobs SET status = 'paused', meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ pausedAt: new Date().toISOString(), pauseReason: reason })}::jsonb
    WHERE id = ${teracJobId} AND status <> 'paused' RETURNING id)
    INSERT INTO ledger (actor, decision, reason, meta, env)
    SELECT 'orchestrator', 'pause', ${reason}, ${JSON.stringify({ teracJobId, opportunityId: id })}::jsonb, 'live' FROM paused`;
}

export async function pollReview(job: JobRow): Promise<void> {
  const payload = object(job.payload);
  const teracJobId = Number(payload.teracJobId);
  if (payload.purpose !== "eval_round" || !Number.isSafeInteger(teracJobId) || teracJobId <= 0) throw new Error("Invalid evaluation polling job.");
  const sql = getSql();
  const [row] = await sql`SELECT * FROM terac_jobs WHERE id = ${teracJobId} AND purpose = 'eval_round'`;
  if (!row) throw new Error("Evaluation opportunity was not found.");
  if (row.status === "completed") return;
  if (!["launched", "paused", "pause_unknown", "pausing"].includes(row.status)) throw new Error("Evaluation launch is not confirmed.");
  let paused = row.status === "paused";
  if (!paused && (payload.action === "pause" || Date.now() >= Date.parse(STOP_AT) || ["pause_unknown", "pausing"].includes(row.status))) {
    await pauseReview(teracJobId, "The registered recruitment stop time was reached."); paused = true;
  }
  const plan = row.meta?.plan as ReturnType<typeof parseOpportunity> | undefined;
  if (!plan || plan.id !== row.opportunity_id || plan.n !== row.num_participants) throw new Error("Stored evaluation plan does not match its opportunity.");
  let statuses;
  try {
    if (!process.env.TERAC_API_KEY || !plan.apiSubmissionsUrl || typeof plan.apiSubmissionsUrl !== "string") throw new Error("No documented read endpoint is configured.");
    statuses = await readSubmissionStatuses(plan.apiSubmissionsUrl, process.env.TERAC_API_KEY);
  } catch {
    const response = await runTerac(`Use terac_get_submissions for opportunity_id=${JSON.stringify(plan.id)}. Read every page.
Return only {"submissions": [{"id": submission_id, "status": status}, ...]} for all submissions.
Do not return participant names, answers, transcripts, reasons, email addresses or other content.`, ["terac_get_submissions"]);
    statuses = submissionStatuses(response.response);
  }
  const unique = new Map(statuses.map(status => [status.id, status]));
  const assignmentText = readFileSync("data/assignment.json", "utf8");
  if (row.meta?.hashes?.["assignment.json"] !== sha256(assignmentText)) throw new Error("Assignments changed after launch; payment approval is blocked.");
  const assignment = Assignment.parse(JSON.parse(assignmentText));
  // Identifiers/counts only. Neither the decider nor the payer reads evaluation labels.
  const saved = await sql`SELECT ta.submission_id, ta.slot, ta.is_test,
    coalesce(array_agg(DISTINCT r.case_id) FILTER (WHERE r.case_id IS NOT NULL), '{}'::text[]) AS case_ids
    FROM task_assignments ta LEFT JOIN reviews r ON r.terac_submission_id = ta.submission_id AND NOT r.is_test
    WHERE NOT ta.is_test AND ta.submission_id IS NOT NULL AND ta.slot BETWEEN 1 AND ${plan.n}
    GROUP BY ta.submission_id, ta.slot, ta.is_test`;
  const completeIds = completedReviewerIds(assignment, saved.map(item => ({ submissionId: item.submission_id,
    slot: Number(item.slot), isTest: item.is_test, caseIds: item.case_ids })), plan.n);
  if (plan.reviewType === "manual_review") {
    for (const submission of unique.values()) {
      if (!completeIds.has(submission.id) || !["awaiting_review", "approved"].includes(submission.status)) continue;
      if (submission.status === "awaiting_review") {
        const response = await runTerac(`Approve exactly submissionId=${JSON.stringify(submission.id)} using terac_approve_submission.
The server verified that all its assigned card IDs have saved responses. Payment is for delivery regardless of decisions or gold performance.
Do not read answers or apply any quality criterion. Return only {"submission": {"id": the_approved_submission_id, "status": the_returned_status}}.`, ["terac_approve_submission"]);
        const approved = object(response.response.submission);
        if ((approved.id ?? approved.submission_id) !== submission.id || approved.status !== "approved") throw new Error("Terac did not confirm the exact submission approval; inspect status before retrying.");
        submission.status = "approved";
      }
      await sql`WITH approved AS (
        UPDATE terac_jobs SET meta = jsonb_set(meta, '{approvedSubmissionIds}', coalesce(meta->'approvedSubmissionIds', '[]'::jsonb) || ${JSON.stringify([submission.id])}::jsonb)
        WHERE id = ${teracJobId} AND NOT (coalesce(meta->'approvedSubmissionIds', '[]'::jsonb) ? ${submission.id}) RETURNING id
      ) INSERT INTO ledger (actor, decision, reason, cost_cents, meta, env)
        SELECT 'orchestrator', 'approve_delivery', 'All assigned card identifiers have saved responses; quality does not affect payment', 0,
          ${JSON.stringify({ teracJobId, opportunityId: plan.id, submissionId: submission.id })}::jsonb, 'live' FROM approved`;
    }
  }
  const completed = [...unique.values()].filter(item => ["completed", "approved"].includes(item.status)).length;
  await sql`UPDATE terac_jobs SET meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ submissions: [...unique.values()], completedSubmissions: completed, lastPolledAt: new Date().toISOString() })}::jsonb WHERE id = ${teracJobId}`;
  if (!paused && (completed >= plan.n || Date.now() >= Date.parse(STOP_AT))) {
    await pauseReview(teracJobId, completed >= plan.n ? "The target number of completed submissions was reached." : "The registered recruitment stop time was reached.");
    paused = true;
  }
  // Recruitment stops at the cutoff; people already working can finish and still be paid.
  if (paused && ![...unique.values()].some(item => ["screen_passed", "in_progress", "awaiting_review"].includes(item.status))) return;
  const delay = paused ? 180 : Math.max(1, Math.min(180, Math.ceil((Date.parse(STOP_AT) - Date.now()) / 1000)));
  // Recording this poll and its successor together makes retries of a poll job idempotent.
  await sql`WITH polled AS (
    UPDATE terac_jobs SET meta = meta || ${JSON.stringify({ lastPollJobId: job.id })}::jsonb
    WHERE id = ${teracJobId} AND status IN ('launched', 'paused') AND coalesce(meta->>'lastPollJobId', '') <> ${String(job.id)} RETURNING id
  ) INSERT INTO jobs (kind, payload, run_after)
    SELECT 'review', ${JSON.stringify({ purpose: "eval_round", action: "poll", teracJobId })}::jsonb, now() + make_interval(secs => ${delay}) FROM polled`;
}
