import { getSql } from "../src/lib/db";
import { provision } from "./handlers/provision";
import { runWorker, type JobHandlers } from "./runner";

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
  const stop = new AbortController();
  const shutdown = () => {
    if (!stop.signal.aborted) console.log("worker stopping after the current job");
    stop.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const handlers: JobHandlers = { provision };
  console.log(`handlers: ${Object.keys(handlers).join(", ")}`);
  try {
    await runWorker(handlers, { signal: stop.signal });
    console.log("worker stopped");
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}

main().catch((err) => {
  console.error("worker failed:", err instanceof Error ? err.name : "unknown error");
  process.exitCode = 1;
});
