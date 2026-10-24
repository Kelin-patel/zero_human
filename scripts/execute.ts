import { executeCase } from "../worker/executor";

// Runs the refund executor for one case, with every check it applies in the worker.
// --dry-run prints the exact Whop call without sending it.
// Usage, from the repo root: npm run script -- scripts/execute.ts --case <case_id> [--dry-run]

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the process environment.
}

async function main() {
  const args = process.argv.slice(2);
  const caseId = args[args.indexOf("--case") + 1];
  if (!args.includes("--case") || !caseId || caseId.startsWith("--")) {
    throw new Error("Usage: npm run script -- scripts/execute.ts --case <case_id> [--dry-run]");
  }
  const outcome = await executeCase(caseId, { dryRun: args.includes("--dry-run") });
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status === "blocked") process.exitCode = 2;
}

main().catch((err) => {
  console.error("execute failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
