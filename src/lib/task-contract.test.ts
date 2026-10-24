import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskResponse, identityFrom, wordCount, resolveCompletionUrl } from "./task-contract";
test("Terac identifiers support primary, fallback and referrer parameters", () => {
  assert.deepEqual(identityFrom(new Request("https://app.test/api/task/session", { headers: { referer: "https://app.test/task?submissionId=test_a&taskId=test" } })), { submissionId: "test_a", taskId: "test" });
  assert.equal(identityFrom(new Request("https://app.test/task?teracSubmissionId=test_first&submissionId=test_second&taskId=test")).submissionId, "test_first");
  assert.throws(() => identityFrom(new Request("https://app.test/task")));
});
test("response validation enforces words, confidence, timing and strips no extra fields", () => {
  const valid = { submissionId: "test_a", taskId: "test", caseId: "case_eval_01", decision: "deny", reason: "The policy and the records support denying this particular refund request.", confidence: 3, secondsSpent: 20 };
  assert.equal(TaskResponse.parse(valid).decision, "deny");
  for (const override of [{reason:"too short"}, {confidence:0}, {confidence:6}, {secondsSpent:-1}, {gold_passed:true}]) assert.equal(TaskResponse.safeParse({...valid,...override}).success, false);
  assert.equal(wordCount("one two three four five six seven eight nine ten"), 10);
  assert.equal(wordCount("... !!!"), 0);
});

test("completion callbacks use only configured HTTPS URLs and explicit placeholders", () => {
  const identity = {submissionId:"test_a",taskId:"test"};
  assert.equal(resolveCompletionUrl("https://terac.com/done?submission={teracSubmissionId}&task={taskId}", identity), "https://terac.com/done?submission=test_a&task=test");
  for (const value of ["javascript:alert(1)", "https://user:pass@terac.com/done", "https://terac.com/{unknown}"]) assert.throws(() => resolveCompletionUrl(value, identity));
});
