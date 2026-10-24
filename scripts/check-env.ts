import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";

// Checks every key and service this machine depends on and prints one line per check.
// Secret values are never printed; only identifiers that are safe to share (like biz_ IDs).
// Run from the repo root: npm run script scripts/check-env.ts

// Next.js and most .env loaders never override a variable that already exists in the shell,
// so a stale system-wide key silently wins over .env.local. Flag those, then test the file's values.
const shadowed: string[] = [];
try {
  const fileVars = parseEnv(readFileSync(".env.local", "utf8"));
  for (const [name, value] of Object.entries(fileVars)) {
    const inherited = process.env[name]?.trim();
    if (inherited && value?.trim() && inherited !== value.trim()) shadowed.push(name);
    process.env[name] = value;
  }
} catch {
  // No .env.local: fall back to whatever is already in the environment.
}

const VARS = [
  "DATABASE_URL",
  "APP_BASE_URL",
  "SI_MERCHANT_KEY_SALT",
  "WHOP_API_KEY",
  "WHOP_BUSINESS_ID",
  "WHOP_WEBHOOK_SECRET",
  "WHOP_SANDBOX_API_KEY",
  "WHOP_SANDBOX_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "EXA_API_KEY",
  "SOLARI_API_KEY",
  "TERAC_API_KEY",
];

const WHOP_API = { live: "https://api.whop.com/api/v1", sandbox: "https://sandbox-api.whop.com/api/v1" };
const TIMEOUT_MS = 20_000;

let failures = 0;

function report(name: string, status: "ok" | "fail" | "skip", detail: string) {
  const icon = status === "ok" ? "✅" : status === "fail" ? "❌" : "⏭️ ";
  if (status === "fail") failures++;
  console.log(`${icon} ${name.padEnd(14)} ${detail}`);
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function getJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the raw text for the error message.
  }
  return { status: res.status, body };
}

function errorText(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.slice(0, 200);
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    report(name, "fail", err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  console.log("Variables in .env.local");
  const missing = VARS.filter((name) => !env(name));
  console.log(`   set: ${VARS.length - missing.length}/${VARS.length}`);
  if (missing.length) console.log(`   missing: ${missing.join(", ")}`);
  for (const name of ["WHOP_WEBHOOK_SECRET", "WHOP_SANDBOX_WEBHOOK_SECRET"]) {
    const value = env(name);
    if (value && !value.startsWith("ws_")) console.log(`   warning: ${name} should keep its ws_ prefix`);
  }
  console.log("");

  for (const name of shadowed) {
    report(
      name,
      "fail",
      "a different value is set in your shell/system environment; the app, the worker and `claude -p` use that one. " +
        `Remove it (PowerShell: [Environment]::SetEnvironmentVariable('${name}', $null, 'User')), then open a new terminal.`,
    );
  }

  for (const mode of ["live", "sandbox"] as const) {
    const name = `whop ${mode}`;
    const key = env(mode === "live" ? "WHOP_API_KEY" : "WHOP_SANDBOX_API_KEY");
    await check(name, async () => {
      if (!key) return report(name, "skip", "no API key yet");
      const { status, body } = await getJson(`${WHOP_API[mode]}/accounts/me`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const account = body as { id?: string; title?: string };
      if (status !== 200 || !account.id?.startsWith("biz_")) {
        return report(name, "fail", `accounts/me -> HTTP ${status} ${errorText(body)}`);
      }
      const expected = env("WHOP_BUSINESS_ID");
      if (mode === "live" && !expected) {
        return report(name, "ok", `${account.id} "${account.title}" (put this in WHOP_BUSINESS_ID)`);
      }
      if (mode === "live" && expected !== account.id) {
        return report(name, "fail", `key belongs to ${account.id}, but WHOP_BUSINESS_ID is ${expected}`);
      }
      report(name, "ok", `${account.id} "${account.title}"`);
    });
  }

  await check("anthropic", async () => {
    const key = env("ANTHROPIC_API_KEY");
    if (!key) return report("anthropic", "skip", "no API key yet");
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    // A one-token request proves the key works and the account has credits.
    const { status, body } = await getJson("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (status !== 200) return report("anthropic", "fail", `HTTP ${status} ${errorText(body)}`);
    report("anthropic", "ok", "key works and the account has credits");
  });

  await check("exa", async () => {
    const key = env("EXA_API_KEY");
    if (!key) return report("exa", "skip", "no API key yet");
    const { status, body } = await getJson("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ query: "online course refund policy", numResults: 1 }),
    });
    const results = (body as { results?: unknown[] }).results;
    if (status !== 200 || !results?.length) return report("exa", "fail", `HTTP ${status} ${errorText(body)}`);
    report("exa", "ok", `${results.length} result`);
  });

  await check("database", async () => {
    const url = env("DATABASE_URL");
    if (!url) return report("database", "skip", "no DATABASE_URL yet");
    const sql = neon(url);
    await sql`SELECT 1`;
    const [table] = await sql`SELECT to_regclass('public.webhook_events') IS NOT NULL AS present`;
    if (!table.present) return report("database", "fail", "connected, but the webhook_events table is missing");
    const [row] = await sql`SELECT count(*)::int AS n FROM webhook_events`;
    report("database", "ok", `SELECT 1 works; webhook_events has ${row.n} rows`);
  });

  await check("deployment", async () => {
    const base = env("APP_BASE_URL");
    if (!base) return report("deployment", "skip", "no APP_BASE_URL yet");
    const url = `${base.replace(/\/+$/, "")}/api/health`;
    const { status, body } = await getJson(url);
    if (status !== 200 || (body as { ok?: boolean }).ok !== true) {
      return report("deployment", "fail", `${url} -> HTTP ${status} ${errorText(body)}`);
    }
    report("deployment", "ok", `${url} -> ok`);
  });

  // The worker drives Claude Code headlessly, so its login and MCP servers matter on this machine.
  await check("claude cli", async () => {
    const auth = spawnSync("claude", ["auth", "status"], { encoding: "utf8", timeout: TIMEOUT_MS });
    if (auth.error) return report("claude cli", "fail", `claude not found on PATH (${auth.error.message})`);
    let loggedIn = false;
    try {
      loggedIn = JSON.parse(auth.stdout).loggedIn === true;
    } catch {
      // Unknown output format: treat as not logged in.
    }
    if (!loggedIn) return report("claude cli", "fail", "not logged in: run `claude auth login` in a terminal");
    report("claude cli", "ok", "logged in");

    const mcp = spawnSync("claude", ["mcp", "list"], { encoding: "utf8", timeout: 60_000 });
    for (const server of ["exa", "terac"]) {
      const line = mcp.stdout.split(/\r?\n/).find((l) => l.startsWith(`${server}:`));
      if (!line) report(`mcp ${server}`, "fail", "not configured");
      else if (line.includes("Connected")) report(`mcp ${server}`, "ok", "connected");
      else if (server === "terac" && /auth/i.test(line)) report(`mcp ${server}`, "skip", "added; sign in once Terac access opens");
      else report(`mcp ${server}`, "fail", line.split(" - ").pop() ?? line);
    }
  });

  console.log("");
  console.log(failures ? `${failures} check(s) failed.` : "All available checks passed.");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error("check-env failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
