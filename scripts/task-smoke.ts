import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql } from "../src/lib/db";
import { CaseRecord } from "../src/lib/case-schema";
import type { TaskSession } from "../src/lib/task-contract";
try { process.loadEnvFile(".env.local"); } catch { /* Host environment is supported. */ }
const base = process.env.TASK_TEST_BASE_URL ?? "http://127.0.0.1:3000";
const identity = { submissionId: process.env.TASK_TEST_SUBMISSION_ID ?? "test_api_review", taskId: "test" };
if (!identity.submissionId.startsWith("test_")) throw new Error("Smoke checks require a test_ submission.");
async function post(path: string, data: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(new URL(path, base), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
  return { status: response.status, data: await response.json() };
}
async function main() {
  assert.equal((await post("/api/task/session", {})).status, 400);
  assert.equal((await post("/api/task/session", identity, { Origin: "https://unrelated.test" })).status, 403);
  const concurrent = await Promise.all(Array.from({length: 4}, () => post("/api/task/session", identity)));
  assert.ok(concurrent.every(r => r.status === 200));
  assert.ok(concurrent.every(r => JSON.stringify(r.data) === JSON.stringify(concurrent[0].data)));
  let session = concurrent[0].data as TaskSession;
  assert.equal(session.isTest, true);
  const records = CaseRecord.array().parse(JSON.parse(readFileSync("data/cases.frozen.json", "utf8")));
  let first: Record<string, unknown> | null = null;
  while (session.card) {
    const safe = JSON.stringify(session);
    for (const field of ["designer_intent", "designer_clause", "expected", "gold_passed", "votes", "dissent", "agent_version"]) assert.ok(!safe.includes(`"${field}"`));
    const record = records.find(r => r.card.id === session.card!.id)!;
    const payload = { ...identity, caseId: session.card.id, decision: record.expected?.decision ?? "need_more_evidence", reason: "This automated test response checks that saving and resuming work correctly.", confidence: 3, secondsSpent: 15 };
    if (!first) {
      assert.equal((await post("/api/task/response", {...payload, reason:"short"})).status, 400);
      assert.equal((await post("/api/task/response", {...payload, caseId:"unassigned"})).status, 403);
      first = payload;
    }
    const saved = await post("/api/task/response", payload);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.completed, session.completed + 1);
    session = saved.data;
    assert.deepEqual((await post("/api/task/session", identity)).data, session);
    assert.deepEqual((await post("/api/task/response", payload)).data, session);
  }
  assert.equal(session.completed, session.total);
  const sql = getSql();
  const [counts] = await sql`select (select count(*)::int from reviews where terac_submission_id = ${identity.submissionId} and is_test) as reviews,
    (select count(*)::int from task_responses where terac_submission_id = ${identity.submissionId} and is_test) as raw,
    (select count(*)::int from reviews where terac_submission_id = ${identity.submissionId} and is_test and is_gold and gold_passed) as gold_passes,
    (select count(*)::int from task_assignments where submission_id = ${identity.submissionId} and is_test) as slots`;
  assert.equal(counts.reviews, session.total); assert.equal(counts.raw, session.total); assert.equal(counts.gold_passes, 1); assert.equal(counts.slots, 1);
  console.log(JSON.stringify({ base, submission: identity.submissionId, completed:session.completed, ...counts, checks:"concurrent claim, validation, privacy, immediate save, retry idempotency, resume, server gold scoring, test isolation" }));
}
main().catch(() => { console.error("Reviewer smoke check failed. No secrets or response contents were logged."); process.exitCode = 1; });
