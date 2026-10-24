import assert from "node:assert/strict";
import { test } from "node:test";
import { completedReviewerIds } from "./review-completion";

const assignment = { slots: [{ slot: 1, overflow: false, case_ids: ["case_eval_01", "case_dev_01", "case_gold_1"] },
  { slot: 12, overflow: true, case_ids: ["case_eval_01"] }] };
const complete = { submissionId: "submission_1", slot: 1, caseIds: ["case_gold_1", "case_eval_01", "case_dev_01"], isTest: false };
test("completion requires every assigned ID, and rejects missing or extra cards", () => {
  assert.deepEqual([...completedReviewerIds(assignment, [complete], 11)], ["submission_1"]);
  assert.equal(completedReviewerIds(assignment, [{ ...complete, caseIds: complete.caseIds.slice(1) }], 11).size, 0);
  assert.equal(completedReviewerIds(assignment, [{ ...complete, caseIds: [...complete.caseIds, "unassigned"] }], 11).size, 0);
});
test("test submissions, unassigned reviewers and overflow slots never authorize payment", () => {
  for (const row of [{ ...complete, isTest: true }, { ...complete, submissionId: "test_fake" },
    { ...complete, slot: 2 }, { ...complete, slot: 12, caseIds: ["case_eval_01"] }]) {
    assert.equal(completedReviewerIds(assignment, [row], 11).size, 0);
  }
});
test("payment verification never reads decisions, reasons or gold scores", () => {
  const row = { ...complete };
  for (const name of ["decision", "reason", "gold_passed", "expected"]) Object.defineProperty(row, name, { get() { throw new Error("Labels must not be read for payment"); } });
  assert.equal(completedReviewerIds(assignment, [row], 11).size, 1);
});
