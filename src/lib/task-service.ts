import { existsSync, readFileSync } from "node:fs";
import { getSql } from "./db";
import { CaseCard, CaseRecord } from "./case-schema";
import { canonicalJson, sha256 } from "./case-generation";
import { loadPolicy } from "./policy";
import { Assignment, assertAssignment } from "./task-assignment";
import { resolveCompletionUrl, TaskResponse, type TaskIdentity, type TaskSession } from "./task-contract";

export class TaskError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function loadTaskData() {
  const frozen = readFileSync("data/cases.frozen.json", "utf8");
  const records = CaseRecord.array().parse(JSON.parse(frozen));
  const text = readFileSync("data/assignment.json", "utf8");
  const assignment = Assignment.parse(JSON.parse(text));
  if (assignment.cases_sha256 !== sha256(frozen) || canonicalJson(assignment) !== text) throw new TaskError("Reviewer assignments are unavailable.", 503);
  assertAssignment(assignment, records);
  return { assignment, records };
}

function assertRegistered(isTest: boolean) {
  if (isTest) return;
  if (!existsSync("data/PREREGISTRATION.md")) throw new TaskError("The review round is not open yet. Please return shortly.", 503);
  const protocol = readFileSync("data/PREREGISTRATION.md", "utf8");
  for (const name of ["policy.v1.md", "cases.frozen.json", "prepared-review.config.json", "decisions_v1.json", "assignment.json"]) {
    const hash = sha256(readFileSync(`data/${name}`, "utf8"));
    if (!protocol.includes(`| ${name} | ${hash} |`)) throw new TaskError("The review round is not open yet. Please return shortly.", 503);
  }
}

async function claim(identity: TaskIdentity) {
  const sql = getSql();
  const isTest = identity.submissionId.startsWith("test_");
  assertRegistered(isTest);
  let existing = await sql`select slot, task_id from task_assignments where submission_id = ${identity.submissionId}`;
  if (!existing.length) {
    try {
      existing = await sql`update task_assignments set submission_id = ${identity.submissionId}, task_id = ${identity.taskId}, assigned_at = now()
        where slot = (select slot from task_assignments where submission_id is null and enabled and is_test = ${isTest}
          order by slot for update skip locked limit 1) returning slot, task_id`;
    } catch (error) {
      // Two tabs can claim the same submission concurrently. The unique constraint picks one.
      existing = await sql`select slot, task_id from task_assignments where submission_id = ${identity.submissionId}`;
      if (!existing.length) throw error;
    }
  }
  if (!existing.length) throw new TaskError("All review places are currently filled. Please return to Terac.", 409);
  if (existing[0].task_id !== identity.taskId) throw new TaskError("Please reopen your original task link from Terac.", 409);
  return { slot: Number(existing[0].slot) - (isTest ? 1000 : 0), isTest };
}

function completionUrl(identity: TaskIdentity, isTest: boolean): string | null {
  if (isTest || !process.env.TERAC_COMPLETION_URL) return null;
  return resolveCompletionUrl(process.env.TERAC_COMPLETION_URL, identity);
}

export async function getTaskSession(identity: TaskIdentity): Promise<TaskSession> {
  const { assignment, records } = loadTaskData();
  const { slot, isTest } = await claim(identity);
  const row = assignment.slots.find(r => r.slot === slot);
  if (!row) throw new TaskError("Reviewer slot is unavailable.", 503);
  // Resume by identifiers only. Evaluation labels remain unread by the application.
  const saved = await getSql()`select case_id from reviews where terac_submission_id = ${identity.submissionId} and is_test = ${isTest}`;
  const completedIds = new Set(saved.map(r => String(r.case_id)));
  const next = row.case_ids.find(id => !completedIds.has(id));
  const record = next ? records.find(r => r.card.id === next) : null;
  if (next && !record) throw new TaskError("Reviewer card is unavailable.", 503);
  const policy = loadPolicy();
  const summary = policy.text.split("\n").filter(line => line.startsWith("| ") && !line.startsWith("| Situation")).map(line => {
    const cells = line.split("|").map(c => c.trim());
    return [cells[1], cells[2]] as [string, string];
  });
  return {
    total: row.case_ids.length, completed: row.case_ids.filter(id => completedIds.has(id)).length,
    card: record ? CaseCard.parse(record.card) : null,
    policy: { text: policy.text, summary }, isTest,
    completionUrl: next ? null : completionUrl(identity, isTest),
  };
}

export async function saveTaskResponse(input: unknown): Promise<TaskSession> {
  const value = TaskResponse.parse(input);
  const before = await getTaskSession(value);
  const sql = getSql();
  const { assignment, records } = loadTaskData();
  const slots = await sql`select slot from task_assignments where submission_id = ${value.submissionId}`;
  const slot = Number(slots[0].slot) - (before.isTest ? 1000 : 0);
  if (!assignment.slots.find(r => r.slot === slot)?.case_ids.includes(value.caseId)) throw new TaskError("This card is not assigned to you.", 403);
  const saved = await sql`select case_id from reviews where case_id = ${value.caseId} and terac_submission_id = ${value.submissionId}`;
  if (saved.length) return before;
  if (before.card?.id !== value.caseId) throw new TaskError("Please answer the current card before continuing.", 409);
  const record = records.find(r => r.card.id === value.caseId)!;
  const isGold = record.set_name === "gold";
  const goldPassed = isGold ? value.decision !== "need_more_evidence" && value.decision === record.expected?.decision : null;
  await sql`with inserted as (
    insert into reviews (case_id, terac_submission_id, task_id, decision, reason, confidence, is_gold, gold_passed, seconds_spent, is_test)
    values (${value.caseId}, ${value.submissionId}, ${value.taskId}, ${value.decision}, ${value.reason}, ${value.confidence}, ${isGold}, ${goldPassed}, ${value.secondsSpent}, ${before.isTest})
    on conflict (case_id, terac_submission_id) do nothing returning id
  ) insert into task_responses (terac_submission_id, task_id, cohort, item_id, answer, is_check, passed, is_test)
    select ${value.submissionId}, ${value.taskId}, ${"prepared_review"}, ${value.caseId}, ${JSON.stringify(value)}::jsonb, ${isGold}, ${goldPassed}, ${before.isTest} from inserted`;
  return getTaskSession(value);
}
