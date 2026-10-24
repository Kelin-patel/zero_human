import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPreparedInputs, runConcurrent, validateBaseline } from "./prepared-baseline";

test("prepared inputs bind the exact 49 public cards and the amended decision limit", () => {
  const inputs = loadPreparedInputs();
  assert.equal(inputs.cards.length, 49);
  assert.equal(inputs.cards.filter(card => card.id.startsWith("case_dev_")).length, 22);
  assert.equal(inputs.cards.filter(card => card.id.startsWith("case_eval_")).length, 27);
  assert.equal(inputs.config.decision_options.limits.maxRefundCents, 19900);
  assert.equal(inputs.policy.sha256, inputs.config.policy_sha256);
  assert.ok(inputs.cards.every(card => !("hidden" in card) && !("expected" in card)));
});

test("a frozen baseline rejects missing, repeated or gold IDs", () => {
  const inputs = loadPreparedInputs();
  const rows = inputs.cards.map(card => ({ case_id: card.id, decision: "deny", clauses: ["§1"], reason: "Test record.", votes: { round1: [], round2: [] }, dissent: null }));
  assert.equal(validateBaseline(rows, inputs.config.case_ids).length, 49);
  assert.throws(() => validateBaseline(rows.slice(1), inputs.config.case_ids));
  assert.throws(() => validateBaseline([...rows.slice(1), rows[1]], inputs.config.case_ids));
  assert.throws(() => validateBaseline([{ ...rows[0], case_id: "case_gold_1" }, ...rows.slice(1)], inputs.config.case_ids));
});

test("the runner bounds concurrency and stops scheduling after failure", async () => {
  let active = 0;
  let max = 0;
  let done = 0;
  await runConcurrent(Array.from({ length: 49 }, (_, index) => index), 4, async () => {
    max = Math.max(max, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--; done++;
  });
  assert.equal(done, 49);
  assert.equal(max, 4);
  let started = 0;
  await assert.rejects(runConcurrent([1, 2, 3, 4, 5], 1, async () => { started++; throw new Error("failed"); }), /failed/);
  assert.equal(started, 1);
});
