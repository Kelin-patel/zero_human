import { loadEnvConfig } from "@next/env";
import { exaTerms, solariCheck } from "../src/lib/evidence";
import { gatherEvidence } from "../worker/handlers/evidence";

loadEnvConfig(process.cwd());

// npm run evidence:check -- --case <case_id>   gathers and stores evidence for one case (same as the worker job)
// npm run evidence:check -- --url <url>         checks one page and prints the result; stores nothing
// npm run evidence:check -- --terms <url>       fetches a terms page through Exa and prints the excerpt; stores nothing
async function main() {
  const [flag, value, ...rest] = process.argv.slice(2);
  if (!value || rest.length || !["--case", "--url", "--terms"].includes(flag)) {
    throw new Error("Usage: npm run evidence:check -- --case <case_id> | --url <url> | --terms <url>");
  }
  if (flag === "--case") {
    console.log(JSON.stringify(await gatherEvidence(value)));
  } else if (flag === "--url") {
    const check = await solariCheck(value);
    console.log(JSON.stringify({ ...check, screenshot: check.screenshot ? `${Math.round(check.screenshot.base64.length * 0.75 / 1024)} KB jpeg` : null }));
  } else {
    console.log(JSON.stringify(await exaTerms(value, ["§2"]), null, 2));
  }
}

main().catch((error) => {
  console.error("Evidence check failed:", error instanceof Error ? error.message : "unknown failure");
  process.exitCode = 1;
});
