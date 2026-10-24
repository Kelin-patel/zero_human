import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// Applies db/schema.sql to DATABASE_URL in one transaction. Every statement is idempotent,
// so running it again is a no-op. Run from the repo root: npm run script scripts/db-migrate.ts

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the process environment.
}

const EXPECTED_TABLES = [
  "agent_notes",
  "cases",
  "decisions",
  "evidence",
  "executions",
  "jobs",
  "ledger",
  "merchants",
  "offers",
  "policies",
  "reviews",
  "task_responses",
  "terac_jobs",
  "webhook_events",
];

// Drops "--" comments, then splits on semicolons that end a line.
function splitStatements(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url);

  const statements = splitStatements(readFileSync("db/schema.sql", "utf8"));
  await sql.transaction(statements.map((statement) => sql.query(statement)));
  console.log(`applied ${statements.length} statements`);

  const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  const present = new Set(rows.map((row) => row.table_name as string));
  const missing = EXPECTED_TABLES.filter((name) => !present.has(name));
  console.log(`tables: ${EXPECTED_TABLES.length - missing.length}/${EXPECTED_TABLES.length} present`);
  if (missing.length) throw new Error(`missing tables: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
