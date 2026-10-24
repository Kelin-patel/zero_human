import { readFileSync } from "node:fs";
import { getSql } from "../src/lib/db";
import { Assignment, assertAssignment } from "../src/lib/task-assignment";
import { readFrozenBundle } from "../src/lib/case-files";
try { process.loadEnvFile(".env.local"); } catch { /* Environment can be supplied by the host. */ }
async function main() {
  const assignment = Assignment.parse(JSON.parse(readFileSync("data/assignment.json", "utf8")));
  assertAssignment(assignment, readFrozenBundle().records);
  const sql = getSql();
  const slots = assignment.slots.flatMap(row => [{slot: row.slot, is_test: false}, {slot: row.slot + 1000, is_test: true}]);
  await sql.transaction([
    sql`update task_assignments set enabled = false where submission_id is null`,
    sql`insert into task_assignments (slot, is_test) select slot, is_test from jsonb_to_recordset(${JSON.stringify(slots)}::jsonb) as x(slot int, is_test boolean) on conflict (slot) do update set enabled = true`,
  ]);
  console.log(`Verified ${slots.length} reviewer slots, including isolated test slots.`);
}
main().catch(() => { console.error("Could not seed reviewer slots."); process.exitCode = 1; });
