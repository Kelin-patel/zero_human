import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CaseCard } from "./case-schema";
import { loadPolicy } from "./policy";
import { createRefundDesk, DeskQuorumError, DeskVote } from "./refund-desk";
import { type structured, type StructuredArgs, type StructuredResult } from "./llm";

const fixtures = JSON.parse(readFileSync("scripts/fixtures/sample-cases.json", "utf8")) as { expected: string; card: CaseCard }[];
const policy = loadPolicy();
function fakeCall(answers: (string | null)[]) {
  const prompts: StructuredArgs<unknown>[] = [];
  const call: typeof structured = async <T>(args: StructuredArgs<T>): Promise<StructuredResult<T>> => {
    prompts.push(args);
    const answer = answers.shift();
    const data = args.label?.endsWith("-dissent") ? { argument: "Consider the opposing reading of the policy.", clauses: ["§7"] }
      : answer === null ? null : { decision: answer, clauses: [answer === "approve" ? "§1" : "§6a"], reason: "The supplied records satisfy the cited clause." };
    return { data: data as T | null, refused: answer === null, stopReason: answer === null ? "refusal" : "end_turn", usage: { input: 10, output: 5 } };
  };
  return { decide: createRefundDesk(call), prompts };
}

test("four fixtures use valid public case cards", () => {
  for (const item of fixtures) CaseCard.parse(item.card);
});

test("amount, dispute and legal/fraud checks bypass every LLM call", async () => {
  const fake = fakeCall([]);
  const card = fixtures[0].card;
  for (const variant of [
    { ...card, price_usd: 100.01 },
    { ...card, records: { ...card.records, disputed: true } },
    ...["lawyer", "lawyers", "attorney", "lawsuit", "sue", "chargeback filed", "fraud", "fraudulent"].map(word => ({ ...card, customer_statement: `I reported ${word}.` })),
  ]) {
    const result = await fake.decide(variant, policy);
    assert.equal(result.decision, "out_of_scope");
    assert.equal(result.usage.input, 0);
    assert.equal(result.calls.length, 0);
  }
  assert.equal(fake.prompts.length, 0);
  assert.equal((await fake.decide({ ...card, price_usd: 60 }, policy, { limits: { maxRefundCents: 5000 } })).decision, "out_of_scope");
});

test("second-round majority decides; hidden data and injected closing tags cannot escape the case", async () => {
  const fake = fakeCall(["approve", "approve", "deny", "dissent", "deny", "deny", "approve"]);
  const card = { ...fixtures[3].card, hidden: { designer_intent: "SECRET_LABEL" }, expected: { decision: "SECRET_LABEL" } };
  const result = await fake.decide(card, policy);
  assert.equal(result.decision, "deny");
  assert.equal(result.calls.length, 7);
  assert.equal(result.usage.input, 70);
  assert.equal(result.notesVersion, "v1");
  assert.equal(result.votes.round2.length, 3);
  const user = fake.prompts[0].user;
  assert.equal((user.match(/<customer_statement>/g) ?? []).length, 1);
  assert.equal((user.match(/<\/customer_statement>/g) ?? []).length, 1);
  assert.equal(user.includes("<system>"), false);
  assert.equal(user.includes("SECRET_LABEL"), false);
  for (const prompt of fake.prompts) {
    assert.ok(prompt.system.includes(policy.text));
    assert.ok(prompt.user === user);
    assert.equal(prompt.effort, "medium");
    assert.equal(prompt.system.includes("Interpretation notes:"), false);
  }
});

test("out_of_scope needs two actual votes; missing answers are abstentions", async () => {
  const yes = fakeCall(["approve", "approve", null, "dissent", "out_of_scope", "out_of_scope", "approve"]);
  assert.equal((await yes.decide(fixtures[0].card, policy)).decision, "out_of_scope");
  const split = fakeCall(["approve", "approve", "deny", "dissent", "approve", "deny", "out_of_scope"]);
  await assert.rejects(split.decide(fixtures[0].card, policy), DeskQuorumError);
  const absent = fakeCall(["approve", null, null]);
  await assert.rejects(absent.decide(fixtures[0].card, policy), DeskQuorumError);
});

test("limits include exactly 100 dollars; notes are versioned; policy hash is checked", async () => {
  const fake = fakeCall(["approve", "approve", "approve", "dissent", "approve", "approve", "approve"]);
  const result = await fake.decide({ ...fixtures[0].card, price_usd: 100, customer_statement: "There is an issue with my course." }, policy, { notes: "Use the recorded progress percentage." });
  assert.equal(result.decision, "approve");
  assert.equal(result.notesVersion, "v2");
  assert.ok(fake.prompts.every(prompt => prompt.system.indexOf("Interpretation notes:") > prompt.system.indexOf(policy.text)));
  await assert.rejects(fake.decide(fixtures[0].card, { ...policy, sha256: "wrong" }), /SHA-256/);
  assert.equal(DeskVote.safeParse({ decision: "approve", clauses: ["§1"], reason: "word ".repeat(41) }).success, false);
});
