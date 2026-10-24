import type { BrowserSession } from "@solarisdk/browser";

// Evidence agents check a customer's claim against the outside world. Everything they return
// (status codes, page titles, page text) is untrusted data and is stored and shown as plain text.

export const EVIDENCE_TIMEOUT_MS = 20_000;
// Screenshots live in the database, so oversized captures are dropped rather than stored.
const MAX_SCREENSHOT_BYTES = 1_500_000;

export interface AccessCheck {
  method: "solari" | "http";
  url: string;
  httpStatus: number | null;
  title: string | null;
  screenshot: { mime: "image/jpeg"; base64: string } | null;
  note?: string;
}

export interface TermsExcerpt {
  url: string;
  title: string | null;
  excerpt: string;
  clauses: string[];
}

export function assertHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Evidence URLs must use http or https.");
  return url.toString();
}

/** Opens the page in a remote Solari browser: status, title and a full-page screenshot. Never downloads files. */
export async function solariCheck(target: string): Promise<AccessCheck> {
  const url = assertHttpUrl(target);
  const apiKey = process.env.SOLARI_API_KEY;
  if (!apiKey) throw new Error("SOLARI_API_KEY is not set");
  const { Solari } = await import("@solarisdk/browser");
  const client = new Solari({ apiKey, baseUrl: "https://api.getsolari.com", timeoutMs: 30_000, maxAttempts: 1 });
  let browser: BrowserSession | undefined;
  try {
    browser = await client.launch();
    const context = await browser.newContext({ acceptDownloads: false, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: EVIDENCE_TIMEOUT_MS });
    const title = (await page.title()).slice(0, 200) || null;
    const image = await page.screenshot({ fullPage: true, type: "jpeg", quality: 60, timeout: EVIDENCE_TIMEOUT_MS });
    const tooLarge = image.length > MAX_SCREENSHOT_BYTES;
    return {
      method: "solari", url, httpStatus: response?.status() ?? null, title,
      screenshot: tooLarge ? null : { mime: "image/jpeg", base64: image.toString("base64") },
      ...(tooLarge ? { note: "Screenshot omitted: page too large to store." } : {}),
    };
  } finally {
    try { await browser?.close(); } finally { await client.close(); }
  }
}

/** Fallback when the remote browser is unavailable: a direct request records the status only. */
export async function httpCheck(target: string): Promise<AccessCheck> {
  const url = assertHttpUrl(target);
  const response = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(EVIDENCE_TIMEOUT_MS) });
  const body = await response.text();
  const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(body)?.[1]?.trim().slice(0, 200) || null;
  return { method: "http", url, httpStatus: response.status, title, screenshot: null };
}

/** Fetches the merchant's terms page through Exa (live crawl) and keeps the paragraphs that matter. */
export async function exaTerms(target: string, clauses: string[]): Promise<TermsExcerpt> {
  const url = assertHttpUrl(target);
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY is not set");
  const response = await fetch("https://api.exa.ai/contents", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ urls: [url], text: { maxCharacters: 20_000 }, livecrawl: "always", livecrawlTimeout: 15_000 }),
    redirect: "error",
    signal: AbortSignal.timeout(EVIDENCE_TIMEOUT_MS + 10_000),
  });
  if (!response.ok) throw new Error(`Exa contents returned HTTP ${response.status}`);
  const data = (await response.json()) as {
    results?: { url?: string; title?: string; text?: string }[];
    statuses?: { status?: string; error?: unknown }[];
  };
  const result = data.results?.[0];
  if (data.statuses?.[0]?.status !== "success" || !result?.text) throw new Error("Exa could not retrieve the terms page.");
  const picked = excerptTerms(result.text, clauses);
  return { url: result.url ?? url, title: result.title?.slice(0, 200) ?? null, ...picked };
}

/**
 * Picks the policy sections the decision relied on (e.g. §2 for "§2" or "§6a"), so the excerpt shows
 * the actual published wording. Falls back to the first section that mentions refunds.
 */
export function excerptTerms(text: string, clauses: string[], maxChars = 1_200): { excerpt: string; clauses: string[] } {
  const sections = text.replace(/\r\n?/g, "\n").split(/\n(?=#{1,3}\s)/u).map((s) => s.trim()).filter(Boolean);
  const wanted = [...new Set(clauses.map((c) => /^§(\d+)/u.exec(c)?.[1]).filter((n): n is string => Boolean(n)))];
  const matches = wanted
    .map((n) => sections.find((s) => new RegExp(`^#{1,3}\\s*§${n}(?!\\d)`, "u").test(s)))
    .filter((s): s is string => Boolean(s));
  const chosen = matches.length ? matches : sections.filter((s) => /refund/iu.test(s) && /^#{1,3}\s*§/u.test(s)).slice(0, 1);
  // Excerpts are shown as plain text, so markdown markers are removed after the sections are matched.
  const body = (chosen.length ? chosen : sections.slice(0, 1)).join("\n\n")
    .replace(/^#{1,3}\s*(.*)$/gmu, "$1:")
    .replace(/\*\*|__/gu, "")
    .replace(/[ \t]+\n/gu, "\n");
  const excerpt = body.length > maxChars ? `${body.slice(0, maxChars - 1).trimEnd()}…` : body;
  return { excerpt, clauses: matches.length ? wanted.map((n) => `§${n}`) : [] };
}
