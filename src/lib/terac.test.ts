import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJson, sha256 } from "./case-generation";
import { headlessCommand, decodeHeadless } from "./terac-headless";
import { balanceFromContext, draftAdjustment, parseOpportunity, PROJECT_ID, readSubmissionStatuses, submissionStatuses } from "./terac-data";
import { registeredRound, REGISTERED_FILES, validateReviewAssignments, verifyRegisteredHashes } from "./registration";
import { registrationInputs, registrationText } from "./preregistration";
import { DraftMcpClient } from "./terac-mcp";

const draft = () => ({ id: "draft_test", project_id: PROJECT_ID, status: "draft", num_participants: 11,
  pricing: { cpi_cents: 750, total_cents: 8250 }, funding: { affordable: true },
  tasks: [{ task_type: "interview", review_type: "auto_approve", duration_minutes: 7, task_url: "https://example.com/task" }],
  links: { dashboard: { draft_editor: "https://terac.com/drafts/test", submissions: "https://terac.com/submissions/test" } } });

test("headless commands restrict tools and omit API credentials from the child environment", () => {
  const command = headlessCommand("A bounded task", ["terac_get_context"], { NODE_ENV: "test", ANTHROPIC_API_KEY: "test-only", CLAUDECODE: "nested", OTHER: "preserved" });
  assert.equal(command.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(command.env.CLAUDECODE, undefined);
  assert.equal(command.env.OTHER, "preserved");
  assert.ok(command.args.includes("mcp__terac__terac_get_context"));
  assert.equal(command.args[command.args.indexOf("--tools") + 1], "");
  assert.ok(!command.args.includes("--dangerously-skip-permissions"));
  assert.deepEqual(decodeHeadless(JSON.stringify({ subtype: "success", result: '{"ok":true}', total_cost_usd: 0.1 })).response, { ok: true });
  assert.deepEqual(decodeHeadless(JSON.stringify({ subtype: "success", structured_output: { response_json: '{"ok":true}' } })).response, { ok: true });
  assert.throws(() => decodeHeadless('{"is_error":true,"result":"failed"}'));
});
test("the free direct-MCP client cannot invoke a paid launch", async () => {
  await assert.rejects(new DraftMcpClient("test-only").call("terac_launch_draft_opportunity", {}), /cannot launch/);
});
test("only explicit cent quotes and matching project/task fields are accepted", () => {
  const parsed = parseOpportunity({ content: [{ type: "text", text: JSON.stringify(draft()) }] });
  assert.equal(parsed.cpiCents, 750); assert.equal(parsed.n, 11); assert.equal(parsed.completionUrl, null);
  assert.equal(balanceFromContext({ organization: { balance_cents: 10000 } }), 10000);
  assert.equal(balanceFromContext({ balanceDollars: 100 }), 10000);
  assert.throws(() => parseOpportunity({ ...draft(), pricing: { cpi: 7.5, total: 82.5 } }));
  assert.throws(() => parseOpportunity({ ...draft(), project_id: "wrong" }));
  assert.throws(() => parseOpportunity({ ...draft(), pricing: { cpi_cents: 750, cost_per_participant_cents: 800, total_cents: 8250 } }));
});
test("actual API manual-review shapes and launched responses without funding parse correctly", () => {
  const raw = { ...draft(), status: "active", funding: undefined,
    pricing: { cost_per_participant_cents: 600, total_cost_cents: 6600 },
    tasks: [{ ...draft().tasks[0], review_type: "manual_review" }],
    links: { submissions: "/api/external/v2/opportunities/draft_test/submissions" } };
  const plan = parseOpportunity(raw);
  assert.equal(plan.reviewType, "manual_review");
  assert.equal(plan.totalCents, 6600);
  assert.equal(plan.affordable, false);
  assert.equal(plan.apiSubmissionsUrl, "https://terac.com/api/external/v2/opportunities/draft_test/submissions");
});
test("a missing callback selects self-report; high CPI selects the shorter design", () => {
  assert.deepEqual(draftAdjustment(parseOpportunity(draft()), 10000), { n: 11, durationMinutes: 7, reviewType: "self_report" });
  const high = parseOpportunity({ ...draft(), pricing: { cpi_cents: 1000, total_cents: 11000 } });
  assert.deepEqual(draftAdjustment(high, 10000), { n: 11, durationMinutes: 5, reviewType: "self_report" });
  const medium = parseOpportunity({ ...draft(), tasks: [{ ...draft().tasks[0], review_type: "self_report" }], pricing: { cpi_cents: 850, total_cents: 9350 } });
  assert.equal(draftAdjustment(medium, 10000)?.n, 10);
});
test("status projection excludes participant content, and read credentials cannot go to arbitrary sites", async () => {
  assert.deepEqual(submissionStatuses({ submissions: [{ id: "submission_1", status: "completed", email: "private", answer: "private" }] }), [{ id: "submission_1", status: "completed" }]);
  await assert.rejects(readSubmissionStatuses("https://unrelated.test/submissions", "test-only"), /HTTPS read endpoint/);
});
test("every committed input hash is required and edited files are rejected", () => {
  const files = Object.fromEntries(REGISTERED_FILES.map(name => [name, readFileSync(`data/${name}`, "utf8")])) as Record<typeof REGISTERED_FILES[number], string>;
  const registration = registrationText(registrationInputs(), { cpiCents: 750, completionMode: "self_report", registeredAt: "2026-10-24T20:00:00Z" });
  verifyRegisteredHashes(registration, files);
  assert.deepEqual(registeredRound(registration), { n: 11, cardsPerReviewer: 8, cpiCents: 750, reviewType: "self_report" });
  assert.throws(() => verifyRegisteredHashes(registration, { ...files, "assignment.json": files["assignment.json"] + " " }));
  assert.throws(() => verifyRegisteredHashes("Missing registration", files));
  assert.equal(sha256(files["decisions_v1.json"]), "e261015364c5efdfbc3064cbf0198c2f43ccc330f11883de226e01db401360db");
});
test("registered reviewer slots must match the funded count, card count and frozen case IDs", () => {
  const input = registrationInputs();
  const ids = new Set(input.records.map(record => record.card.id));
  validateReviewAssignments(JSON.parse(canonicalJson(input.assignment)), 11, 8, ids);
  assert.throws(() => validateReviewAssignments(input.assignment, 10, 8, ids));
  assert.throws(() => validateReviewAssignments(input.assignment, 11, 6, ids));
});
