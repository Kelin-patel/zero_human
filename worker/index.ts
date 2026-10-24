import { getSql } from "../src/lib/db";

// Local runs read .env.local; a hosted worker gets its variables from the environment instead.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the process environment.
}

async function main() {
  console.log("worker up");
  const sql = getSql();
  const rows = await sql`SELECT 1 AS ok`;
  console.log("db:", rows[0]);
}

main().catch((err) => {
  console.error("worker failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
