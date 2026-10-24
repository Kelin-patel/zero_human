import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createStructuredCaller, MODEL } from "./llm";

function transport(replies: { text: string; stop?: string; status?: number }[]) {
  const requests: Record<string, unknown>[] = [];
  const client = new Anthropic({ apiKey: "test-only", maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const reply = replies.shift();
      assert.ok(reply, "Unexpected extra request");
      return new Response(JSON.stringify(reply.status ? { type: "error", error: { type: "authentication_error", message: "Test authentication failure" } } : {
        id: "msg_test", type: "message", role: "assistant", model: MODEL,
        content: [{ type: "text", text: reply.text }], stop_reason: reply.stop ?? "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    },
  });
  return { call: createStructuredCaller(client), requests };
}
const args = { schema: z.object({ answer: z.string() }), system: "Answer the question.", user: "A test question", effort: "low" as const };

test("structured output uses the SDK parser and sends effort without sampling controls", async () => {
  const { call, requests } = transport([{ text: '{"answer":"valid"}' }]);
  const result = await call(args);
  assert.deepEqual(result.data, { answer: "valid" });
  assert.equal(result.attempts, 1);
  assert.equal(requests[0].model, MODEL);
  assert.equal(requests[0].fallbacks, "default");
  assert.equal((requests[0].output_config as { effort: string }).effort, "low");
  for (const key of ["temperature", "top_p", "top_k", "thinking"]) assert.equal(key in requests[0], false);
});

test("malformed JSON and schema mismatches retry once and retain both attempts' usage", async () => {
  const { call } = transport([{ text: "nonsense" }, { text: '{"wrong":true}' }]);
  const result = await call(args);
  assert.equal(result.data, null);
  assert.equal(result.refused, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.usage.input, 20);
  assert.equal(result.usage.output, 10);
});

test("a refusal cannot become parsed data and may recover on the one retry", async () => {
  const { call } = transport([{ text: "I cannot answer", stop: "refusal" }, { text: '{"answer":"valid"}' }]);
  assert.deepEqual((await call(args)).data, { answer: "valid" });
  const refusing = transport([{ text: '{"answer":"reject"}', stop: "refusal" }, { text: "No", stop: "refusal" }]);
  const result = await refusing.call(args);
  assert.equal(result.data, null);
  assert.equal(result.refused, true);
});

test("token-limited output never becomes a decision even when the JSON parses", async () => {
  const { call } = transport([{ text: '{"answer":"truncated"}', stop: "max_tokens" }, { text: '{"answer":"valid"}' }]);
  assert.equal((await call(args)).data?.answer, "valid");
});

test("authentication errors remain actionable failures and are not swallowed as bad output", async () => {
  const { call, requests } = transport([{ text: "", status: 401 }]);
  await assert.rejects(call(args), Anthropic.AuthenticationError);
  assert.equal(requests.length, 1);
});
