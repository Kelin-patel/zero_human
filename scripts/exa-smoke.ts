import { requireEnv, runSmokeCheck, SmokeCheckError } from "./lib/smoke";

void runSmokeCheck("Exa", async () => {
  const apiKey = requireEnv("EXA_API_KEY");
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "online course refund policy",
      numResults: 2,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new SmokeCheckError(
      `Search returned HTTP ${response.status}. Check the API key, available credits, and rate limits.`,
    );
  }

  const data: unknown = await response.json();
  const results =
    data && typeof data === "object" && "results" in data
      ? data.results
      : undefined;

  if (
    !Array.isArray(results) ||
    results.length !== 2 ||
    !results.every(
      (result: unknown) =>
        result !== null &&
        typeof result === "object" &&
        "url" in result &&
        typeof result.url === "string" &&
        /^https?:\/\//.test(result.url),
    )
  ) {
    throw new SmokeCheckError("Expected exactly 2 search results with web URLs.");
  }

  console.log("Exa OK: received 2 search results.");
});
