import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, sha256 } from "../src/lib/case-generation";
import { readFrozenBundle } from "../src/lib/case-files";
import { Assignment, assertAssignment, makeAssignment } from "../src/lib/task-assignment";

const args = process.argv.slice(2);
const check = args.includes("--check");
const participants = Number(args.find(a => a.startsWith("--participants="))?.split("=")[1] ?? 11);
const cards = Number(args.find(a => a.startsWith("--cards="))?.split("=")[1] ?? 8);
if (![10, 11].includes(participants) || ![6, 8].includes(cards) || args.some(a => a !== "--check" && !/^--participants=(10|11)$|^--cards=(6|8)$/.test(a))) throw new Error("Use --check, --participants=10|11 and --cards=6|8.");
const { records, manifest } = readFrozenBundle();
const path = "data/assignment.json";
if (check) {
  const text = readFileSync(path, "utf8");
  const table = Assignment.parse(JSON.parse(text));
  assertAssignment(table, records);
  if (table.cases_sha256 !== manifest.sha256["cases.frozen.json"] || canonicalJson(table) !== text) throw new Error("Assignment checksum or encoding differs.");
  console.log(`Verified assignment SHA-256: ${sha256(text)}`);
} else {
  if (existsSync("data/PREREGISTRATION.md")) throw new Error("Registered assignment cannot be replaced.");
  const text = canonicalJson(makeAssignment(records, manifest.sha256["cases.frozen.json"], participants as 10 | 11, cards as 6 | 8));
  writeFileSync(path, text);
  console.log(`Assignment SHA-256: ${sha256(text)}`);
}
