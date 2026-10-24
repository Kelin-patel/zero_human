import assert from "node:assert/strict";
import { test } from "node:test";
import { CaseCard, CaseRecord } from "./case-schema";

const card = {
  id: "sample",
  product: "Example Academy course",
  price_usd: 79,
  purchased: "2026-10-10",
  requested: "2026-10-21",
  days_since_purchase: 11,
  records: {
    progress_pct: 18,
    bonus_files_downloaded: false,
    certificate_issued: false,
    prior_refunds_for_this_course: 0,
    access_check: { url: "https://example.com/demo/course/ok", http_status: 200, checked_at: "2026-10-21T14:02:00-04:00" },
  },
  customer_statement: "I changed my mind and have not downloaded any bonus files.",
  store_position: "The store has not approved this refund.",
  evidence: [],
};

test("reviewer card parsing strips private metadata, including nested extras", () => {
  const parsed = CaseCard.parse({
    ...card,
    hidden: { designer_intent: "approve", category: "C1" },
    expected: { decision: "approve" },
    records: { ...card.records, customer_email: "private" },
  });
  assert.deepEqual(parsed, card);
});

test("invalid progress, negative ages, and oversized statements are rejected", () => {
  assert.equal(CaseCard.safeParse({ ...card, records: { ...card.records, progress_pct: 101 } }).success, false);
  assert.equal(CaseCard.safeParse({ ...card, days_since_purchase: -1 }).success, false);
  assert.equal(CaseCard.safeParse({ ...card, customer_statement: "x".repeat(601) }).success, false);
});

test("only gold records carry expected decisions and gold requires one", () => {
  assert.equal(CaseRecord.safeParse({ card, set_name: "gold" }).success, false);
  assert.equal(CaseRecord.safeParse({ card, set_name: "eval", expected: { decision: "deny" } }).success, false);
  assert.equal(CaseRecord.safeParse({ card, set_name: "gold", expected: { decision: "deny" } }).success, true);
});
