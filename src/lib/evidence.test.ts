import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertHttpUrl, excerptTerms } from "./evidence";

const policy = readFileSync("data/policy.v1.md", "utf8");

test("the excerpt is the policy section the decision cited", () => {
  const picked = excerptTerms(policy, ["§2"]);
  assert.match(picked.excerpt, /^## §2 Content we failed to deliver/u);
  assert.doesNotMatch(picked.excerpt, /## §3/u);
  assert.deepEqual(picked.clauses, ["§2"]);
});

test("sub-clauses map to their section, and several sections are kept in order", () => {
  const picked = excerptTerms(policy, ["§6a", "§1"], 5_000);
  assert.match(picked.excerpt, /^## §6 Not covered[\s\S]*## §1 Standard refund window/u);
  assert.deepEqual(picked.clauses, ["§6", "§1"]);
});

test("§1 never matches §10-style numbers, and no clauses falls back to a refund section", () => {
  const text = "# Terms\n\n## §10 Other\nNothing here.\n\n## §1 Refund window\nRefunds within 14 days.";
  assert.match(excerptTerms(text, ["§1"]).excerpt, /^## §1 Refund window/u);
  const fallback = excerptTerms(text, []);
  assert.match(fallback.excerpt, /Refunds within 14 days/u);
  assert.deepEqual(fallback.clauses, []);
});

test("long excerpts are cut, and only web URLs are accepted", () => {
  assert.ok(excerptTerms(policy, ["§6"], 100).excerpt.length <= 100);
  assert.equal(assertHttpUrl("https://example.com/a"), "https://example.com/a");
  assert.throws(() => assertHttpUrl("file:///etc/passwd"), /http or https/);
  assert.throws(() => assertHttpUrl("not a url"));
});
