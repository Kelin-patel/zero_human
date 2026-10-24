import { test } from "node:test";
import assert from "node:assert/strict";
import { readFrozenBundle } from "./case-files";
import { makeAssignment, assertAssignment } from "./task-assignment";
const { records, manifest } = readFrozenBundle();
const hash = manifest.sha256["cases.frozen.json"];
for (const cards of [6, 8] as const) test(`${cards}-card assignments preserve independent coverage and deterministic order`, () => {
  const assignment = makeAssignment(records, hash, 11, cards);
  assertAssignment(assignment, records);
  assert.deepEqual(assignment, makeAssignment(records, hash, 11, cards));
  const primary = assignment.slots.filter(r => !r.overflow);
  const counts = new Map<string, number>();
  for (const row of primary) {
    assert.equal(row.case_ids.length, cards);
    assert.equal(new Set(row.case_ids).size, cards);
    assert.equal(row.case_ids.filter(id => id.includes("gold")).length, 1);
    for (const id of row.case_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const evalCounts = [...counts].filter(([id]) => id.includes("eval")).map(([, n]) => n);
  const devCounts = [...counts].filter(([id]) => id.includes("dev")).map(([, n]) => n);
  assert.equal(evalCounts.length, cards === 8 ? 27 : 20);
  assert.equal(devCounts.length, cards === 8 ? 22 : 13);
  assert.ok(evalCounts.every(n => n === 2 || n === 3));
  assert.equal(evalCounts.filter(n => n === 3).length, cards === 8 ? 1 : 2);
  assert.ok(devCounts.every(n => n === 1));
  assert.deepEqual(assignment.slots.filter(r => r.overflow).map(r => r.slot), [12, 13, 14, 15, 16]);
  assert.ok(assignment.slots.filter(r => r.overflow).every(r => r.case_ids.every(id => id.includes("eval"))));
});
test("ten-person design drops only the eleventh primary slot", () => {
  const full = makeAssignment(records, hash);
  const reduced = makeAssignment(records, hash, 10);
  assert.deepEqual(reduced.slots.filter(r => !r.overflow), full.slots.filter(r => !r.overflow).slice(0, 10));
});
test("assignment tampering is rejected", () => {
  const table = makeAssignment(records, hash);
  table.slots[0].case_ids[0] = "other";
  assert.throws(() => assertAssignment(table, records));
});
