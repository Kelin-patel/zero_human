import { getSql } from "../src/lib/db";
import { decideCase } from "./handlers/decide";
import { execute } from "./executor";
import { evidence } from "./handlers/evidence";
import { provision } from "./handlers/provision";
import { review } from "./handlers/review";
import { claimReviewWorkerJob, registerFollowupWorker } from "../src/lib/review-orchestration";
import { finishJob, failJob } from "../src/lib/repo";
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
  await registerFollowupWorker();
  const stop = new AbortController();
  const shutdown = () => {
    if (!stop.signal.aborted) console.log("worker stopping after the current job");
    stop.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const handlers: JobHandlers = { provision, decide: decideCase, evidence, execute };
  console.log(`handlers: ${Object.keys(handlers).join(", ")}`);
  try {
    const enabledHandlers = { ...handlers, review };
    console.log(`enabled handlers: ${Object.keys(enabledHandlers).join(", ")}`);
    await runWorker(enabledHandlers, { signal: stop.signal, repository: { claimNextJob: claimReviewWorkerJob, finishJob, failJob } });
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
