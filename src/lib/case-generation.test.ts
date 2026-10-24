import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, Candidate, CASE_SEED, CATEGORIES, consistencyIssues, largestRemainder, NEUTRAL_POSITION, selectCases } from "./case-generation";
import { goldCases } from "./gold-cases";
import { readFrozenBundle, writeFrozenBundle } from "./case-files";

const baseUrl = "https://example.com";
function fixtures(): Candidate[] {
  return CATEGORIES.flatMap(({ category, count }) => Array.from({ length: count }, (_, index) => ({
    card: {
      id: `candidate_${category}_${String(index + 1).padStart(2, "0")}`,
      product: `Prepared course ${category} ${index + 1}`,
      price_usd: 79,
      purchased: "2026-10-10",
      requested: "2026-10-21",
      days_since_purchase: 11,
      records: { progress_pct: 18, bonus_files_downloaded: false, certificate_issued: false, prior_refunds_for_this_course: 0,
        access_check: { url: `${baseUrl}/demo/course/ok`, http_status: 200, checked_at: "2026-10-21T12:00:00-04:00" } },
      customer_statement: `I changed my mind about course ${category}, example ${index + 1}, and downloaded no bonus files.`,
      store_position: NEUTRAL_POSITION,
      evidence: [],
    },
    hidden: { category, designer_clause: "§1", designer_intent: "approve" as const },
  })));
}

test("largest-remainder allocation preserves the total with stable tie breaking", () => {
  const selected = largestRemainder(CATEGORIES.map(item => item.count), 49);
  assert.deepEqual(selected, [6, 6, 7, 6, 5, 4, 5, 4, 3, 3]);
  assert.deepEqual(largestRemainder(selected, 22), [3, 3, 3, 3, 2, 2, 2, 2, 1, 1]);
});

test("selection is repeatable, stratified, disjoint, and independent of design intent", () => {
  const source = fixtures();
  const selected = selectCases(source, baseUrl);
  assert.deepEqual(selected, selectCases(source, baseUrl));
  assert.equal(selected.records.filter(item => item.set_name === "dev").length, 22);
  assert.equal(selected.records.filter(item => item.set_name === "eval").length, 27);
  assert.equal(new Set(selected.assignments.map(item => item.candidate_id)).size, 49);
  assert.deepEqual(selected.assignments, selectCases(source.map(item => ({ ...item, hidden: { ...item.hidden, designer_intent: "deny" } })), baseUrl).assignments);
  assert.equal(CASE_SEED, 20261024);
});

test("bad dates, certificate progress, mismatched access routes, and personal details are filtered", () => {
  const candidate = fixtures()[0];
  assert.equal(consistencyIssues(candidate, baseUrl).length, 0);
  for (const changed of [
    { ...candidate, card: { ...candidate.card, days_since_purchase: 10 } },
    { ...candidate, card: { ...candidate.card, purchased: "2026-02-30" } },
    { ...candidate, card: { ...candidate.card, records: { ...candidate.card.records, certificate_issued: true } } },
    { ...candidate, card: { ...candidate.card, records: { ...candidate.card.records, access_check: { ...candidate.card.records.access_check, http_status: 404 } } } },
    { ...candidate, card: { ...candidate.card, customer_statement: "My name is Jordan Smith." } },
    { ...candidate, card: { ...candidate.card, customer_statement: "My name is Jordan Design." } },
    { ...candidate, card: { ...candidate.card, customer_statement: "I am Jordan McDonald." } },
    { ...candidate, card: { ...candidate.card, customer_statement: "Call me at 212-555-0199." } },
    { ...candidate, card: { ...candidate.card, customer_statement: "Contact customer@example.test." } },
  ]) assert.ok(consistencyIssues(changed, baseUrl).length > 0);
  assert.deepEqual(consistencyIssues({ ...candidate, card: { ...candidate.card, customer_statement: "The promised Client Contracts module and Email Automation lessons are missing." } }, baseUrl), []);
  assert.deepEqual(consistencyIssues({ ...candidate, card: { ...candidate.card, customer_statement: "I signed in at noon. The Quarterly Tax and Scrum Fundamentals modules are unavailable." } }, baseUrl), []);
  assert.deepEqual(consistencyIssues({ ...candidate, card: { ...candidate.card, customer_statement: "On October 21 I signed in. Since October 10 I have opened no lessons." } }, baseUrl), []);
  const source = fixtures();
  source[0].card.days_since_purchase = 10;
  assert.equal(selectCases(source, baseUrl).rejected.length, 1);
  source.slice(1, 5).forEach(item => { item.card.days_since_purchase = 10; });
  assert.throws(() => selectCases(source, baseUrl), /eligible candidates/);
});

test("gold cards have unambiguous expected decisions and internally consistent facts", () => {
  const gold = goldCases(baseUrl);
  assert.deepEqual(gold.map(item => item.expected?.decision), ["approve", "deny", "approve", "deny"]);
  assert.equal(gold[1].card.days_since_purchase, 210);
  for (const item of gold) {
    assert.deepEqual(consistencyIssues({ card: item.card, hidden: { category: "C1", designer_clause: "§1", designer_intent: item.expected!.decision } }, baseUrl, true), []);
  }
});

test("bundle verification detects edits and refuses to overwrite existing files", () => {
  const original = process.cwd();
  const policy = readFileSync(join(original, "data/policy.v1.md"), "utf8");
  const root = mkdtempSync(join(tmpdir(), "case-bundle-"));
  try {
    process.chdir(root);
    // The bundle writer creates data/; put the fixed policy there first.
    mkdirSync("data");
    writeFileSync("data/policy.v1.md", policy);
    writeFrozenBundle(fixtures(), baseUrl, { source: "test-only" });
    assert.equal(readFrozenBundle().records.length, 53);
    assert.throws(() => writeFrozenBundle(fixtures(), baseUrl, {}), /not be overwritten/);
    writeFileSync("data/cases.frozen.json", canonicalJson([]));
    assert.throws(() => readFrozenBundle(), /Checksum mismatch/);
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(existsSync(join(root, "data")), false);
});
