import assert from "node:assert/strict";
import test from "node:test";
import type { CaseCard } from "./case-schema";
import { assertDevelopmentFeedback, assertLearningWindow, renderNotes, selectLearnerInputs, validateLearnerOutput, type LearnerOutput } from "./learner";

const card = (id: string): CaseCard => ({
  id, product: "Course", price_usd: 49, purchased: "2026-10-01", requested: "2026-10-10", days_since_purchase: 9,
  records: { progress_pct: 10, bonus_files_downloaded: false, certificate_issued: false, prior_refunds_for_this_course: 0,
    access_check: { url: "https://example.com/demo/course/ok", http_status: 200, checked_at: "2026-10-10" } },
  customer_statement: "It was not what I expected.", store_position: "The store has not approved this refund.", evidence: [],
});
const devCards = [card("case_dev_01"), card("case_dev_02")];
const baseline = [
  { case_id: "case_dev_01", decision: "deny" as const, clauses: ["§2"], reason: "Outside window." },
  { case_id: "case_dev_02", decision: "approve" as const, clauses: ["§1"], reason: "Within window." },
];
const base = {
  primarySlots: [1, 2, 3], devCards, baseline, useTestRows: false,
  reviewers: [
    { submissionId: "s_pass", slot: 1, isTest: false },
    { submissionId: "s_fail", slot: 2, isTest: false },
    { submissionId: "s_overflow", slot: 12, isTest: false },
    { submissionId: "test_x", slot: 1003, isTest: true },
  ],
  gold: [
    { submissionId: "s_pass", goldPassed: true }, { submissionId: "s_fail", goldPassed: false },
    { submissionId: "s_overflow", goldPassed: true }, { submissionId: "test_x", goldPassed: true },
  ],
  labels: [
    { submissionId: "s_pass", caseId: "case_dev_01", decision: "approve", reason: "Access was broken so it qualifies.", confidence: 4 },
    { submissionId: "s_pass", caseId: "case_dev_02", decision: "approve", reason: "Clearly inside the refund window here.", confidence: 5 },
    { submissionId: "s_fail", caseId: "case_dev_01", decision: "approve", reason: "Failed gold so this must be ignored.", confidence: 3 },
    { submissionId: "s_overflow", caseId: "case_dev_01", decision: "approve", reason: "Overflow slots never feed the learner.", confidence: 3 },
    { submissionId: "test_x", caseId: "case_dev_01", decision: "approve", reason: "Automated test rows are not labels.", confidence: 3 },
  ],
};

test("only primary-slot reviewers who passed gold feed the learner, and test rows stay separate", () => {
  const selected = selectLearnerInputs(base);
  assert.equal(selected.eligibleReviewers, 1);
  assert.equal(selected.devLabels, 2);
  assert.equal(selected.agreements, 1);
  assert.deepEqual(selected.disagreements.map(d => d.caseId), ["case_dev_01"]);
  const rehearsal = selectLearnerInputs({ ...base, useTestRows: true });
  assert.equal(rehearsal.eligibleReviewers, 1);
  assert.deepEqual(rehearsal.disagreements.map(d => d.caseId), ["case_dev_01"]);
});

test("missing gold or need_more_evidence on gold is never eligible", () => {
  const selected = selectLearnerInputs({ ...base, gold: [{ submissionId: "s_pass", goldPassed: null }] });
  assert.equal(selected.eligibleReviewers, 0);
  assert.equal(selected.disagreements.length, 0);
});

test("a non-development label is rejected rather than silently used", () => {
  const labels = [{ submissionId: "s_pass", caseId: "case_eval_01", decision: "deny", reason: "x", confidence: 1 }];
  assert.throws(() => selectLearnerInputs({ ...base, labels }), /not a development case/);
});

const output: LearnerOutput = {
  notes: [{ text: "A broken access link counts as non-delivery.", clauses: ["§2"], source_case_ids: ["case_dev_01"] }],
  examples: [{ source_case_id: "case_dev_01", situation: "Course link returns 404.", decision: "approve", clauses: ["§2"], explanation: "Access failed." }],
};

test("output may cite only the development disagreements it was shown", () => {
  assert.deepEqual(validateLearnerOutput(output, ["case_dev_01"]), ["case_dev_01"]);
  assert.throws(() => validateLearnerOutput(output, ["case_dev_02"]), /not one of its development inputs/);
  const leaky = { ...output, notes: [{ ...output.notes[0], text: "Unlike case_eval_03, approve." }] };
  assert.throws(() => validateLearnerOutput(leaky, ["case_dev_01"]), /evaluation or gold/);
});

test("rendered notes omit case IDs and are empty when there is nothing to learn", () => {
  const text = renderNotes(output);
  assert.match(text, /^1\. A broken access link/);
  assert.match(text, /Worked examples:\nA\. Course link returns 404\. -> approve \(§2\)/);
  assert.doesNotMatch(text, /case_dev_/);
  assert.equal(renderNotes({ notes: [], examples: [] }), "");
});


test("the real learner waits for the cutoff or a completed-target pause while dry runs remain available", () => {
  const base = {dryRun:false, nowMs:100, cutoffMs:200, roundStatus:"launched", completedParticipants:0, targetParticipants:11};
  assert.throws(() => assertLearningWindow(base), /collection is still open/);
  assert.doesNotThrow(() => assertLearningWindow({...base,dryRun:true}));
  assert.doesNotThrow(() => assertLearningWindow({...base,nowMs:200}));
  assert.doesNotThrow(() => assertLearningWindow({...base,roundStatus:"paused",completedParticipants:11}));
  assert.throws(() => assertLearningWindow({...base,roundStatus:"paused",completedParticipants:10}), /collection is still open/);
});

test("real learning requires eligible development feedback even when there are no disagreements", () => {
  assert.throws(() => assertDevelopmentFeedback(false, 0), /No eligible development labels/);
  assert.doesNotThrow(() => assertDevelopmentFeedback(false, 1));
  assert.doesNotThrow(() => assertDevelopmentFeedback(true, 0));
});

test("a test identifier cannot enter real learner inputs through a false test flag", () => {
  const selected = selectLearnerInputs({...base,
    reviewers:[{submissionId:"test_misflagged",slot:1,isTest:false}],
    gold:[{submissionId:"test_misflagged",goldPassed:true}],
    labels:[{submissionId:"test_misflagged",caseId:"case_dev_01",decision:"approve",reason:"This automated response must stay out of real learning.",confidence:3}]});
  assert.equal(selected.eligibleReviewers,0);
  assert.equal(selected.devLabels,0);
});
