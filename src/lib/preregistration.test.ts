import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "./case-generation";
import { CaseRecord } from "./case-schema";
import { registrationInputs, registrationText } from "./preregistration";

test("registration requires an exact canonical 49-case baseline and frozen decision options", () => {
  const original = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), "review-registration-"));
  cpSync(join(original, "data"), join(temporary, "data"), {recursive:true});
  try {
    process.chdir(temporary);
    rmSync("data/decisions_v1.json", {force:true});
    assert.throws(() => registrationInputs());
    const records = CaseRecord.array().parse(JSON.parse(readFileSync("data/cases.frozen.json", "utf8")));
    const baseline = records.filter(r => ["dev", "eval"].includes(r.set_name)).map(r => ({case_id:r.card.id, decision:"deny", clauses:["§1"], reason:"Automated validation fixture only.", votes:[], dissent:[]}));
    writeFileSync("data/decisions_v1.json", canonicalJson(baseline));
    const input = registrationInputs();
    const text = registrationText(input, { cpiCents:800, completionMode:"self_report", registeredAt:"2026-10-24T20:00:00Z" });
    assert.match(text, /exact McNemar/); assert.match(text, /17:30/); assert.match(text, /is_test = true/);
    assert.match(text, /Overflow slots 12–16/); assert.match(text, /27 distinct evaluation and 22 distinct development/);
    assert.ok(text.includes(input.hashes["decisions_v1.json"]));
    writeFileSync("data/decisions_v1.json", canonicalJson(baseline.slice(1)));
    assert.throws(() => registrationInputs(), /exactly the 49/);
    writeFileSync("data/decisions_v1.json", canonicalJson(baseline));
    const config = JSON.parse(readFileSync("data/prepared-review.config.json", "utf8"));
    config.decision_options.limits.maxRefundCents = 10000;
    writeFileSync("data/prepared-review.config.json", canonicalJson(config));
    assert.throws(() => registrationInputs(), /configuration differs/);
  } finally { process.chdir(original); rmSync(temporary, {recursive:true, force:true}); }
});
