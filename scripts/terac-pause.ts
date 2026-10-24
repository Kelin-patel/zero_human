import { loadEnvConfig } from "@next/env";
import { pauseReview } from "../src/lib/review-orchestration";
loadEnvConfig(process.cwd());
const id = Number(process.argv[2]);
if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Usage: npm run terac:pause -- <terac_jobs id>");
pauseReview(id, "Operator requested a recruitment pause.").catch(error => {
  console.error("Pause failed:", error instanceof Error ? error.name : "unknown error"); process.exitCode = 1;
});
