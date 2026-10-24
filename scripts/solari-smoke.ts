import { writeFile } from "node:fs/promises";
import type { BrowserSession } from "@solarisdk/browser";
import { requireEnv, runSmokeCheck, SmokeCheckError } from "./lib/smoke";

void runSmokeCheck("Solari", async () => {
  const apiKey = requireEnv("SOLARI_API_KEY");
  const { Solari } = await import("@solarisdk/browser");
  const client = new Solari({
    apiKey,
    baseUrl: "https://api.getsolari.com",
    timeoutMs: 30_000,
    maxAttempts: 1,
  });
  let browser: BrowserSession | undefined;

  try {
    browser = await client.launch();
    const page = await browser.newPage();
    const response = await page.goto("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const status = response?.status();
    const title = await page.title();

    if (status !== 200 || title !== "Example Domain") {
      throw new SmokeCheckError("Expected HTTP 200 and the title Example Domain.");
    }

    const png = await page.screenshot({ fullPage: true, timeout: 30_000 });
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!png.subarray(0, 8).equals(pngSignature)) {
      throw new SmokeCheckError("The browser did not return a PNG screenshot.");
    }
    await writeFile("solari-smoke.png", png);
  } finally {
    try {
      await browser?.close();
    } finally {
      await client.close();
    }
  }

  console.log("Solari OK: 200 Example Domain; saved solari-smoke.png; session closed.");
});
