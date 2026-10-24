import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";

// Registers the deployment's Whop webhook on the live and/or sandbox account, saves each
// signing secret straight into .env.local (Whop shows it only once), then sends a test event.
//
// Usage, from the repo root:
//   npx tsx scripts/whop-webhooks.ts [live|sandbox|both] [--replace]
//   --replace  delete an existing webhook for the same URL and create a fresh one (new secret)

const ENV_FILE = ".env.local";

// .env.local wins over inherited shell variables, so the keys used are the ones this script writes to.
try {
  Object.assign(process.env, parseEnv(readFileSync(ENV_FILE, "utf8")));
} catch {
  // No .env.local: fall back to whatever is already in the environment.
}

// Payloads are pinned to the API version @whop/sdk 2.6 sends, so webhook data matches the SDK types.
const API_VERSION_DATE = "2026-10-15-1";
const EVENTS = ["payment.succeeded", "refund.created", "refund.updated"];
const TIMEOUT_MS = 30_000;

const TARGETS = {
  live: {
    api: "https://api.whop.com/api/v1",
    keyVar: "WHOP_API_KEY",
    secretVar: "WHOP_WEBHOOK_SECRET",
    query: "",
  },
  sandbox: {
    api: "https://sandbox-api.whop.com/api/v1",
    keyVar: "WHOP_SANDBOX_API_KEY",
    secretVar: "WHOP_SANDBOX_WEBHOOK_SECRET",
    query: "?env=sandbox",
  },
} as const;

type Mode = keyof typeof TARGETS;

interface Webhook {
  id: string;
  url: string;
  enabled: boolean;
  events: string[];
  api_version_date: string | null;
  webhook_secret: string | null;
}

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const which = args.find((a) => !a.startsWith("--")) ?? "both";
if (!["live", "sandbox", "both"].includes(which)) {
  console.error("Usage: npx tsx scripts/whop-webhooks.ts [live|sandbox|both] [--replace]");
  process.exit(1);
}
const modes: Mode[] = which === "both" ? ["live", "sandbox"] : [which as Mode];

const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
if (!base || !/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) {
  console.error("APP_BASE_URL must be the public https deployment URL (Whop rejects localhost).");
  process.exit(1);
}

async function whop<T>(mode: Mode, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env[TARGETS[mode].keyVar]?.trim();
  if (!key) throw new Error(`${TARGETS[mode].keyVar} is empty in ${ENV_FILE}`);
  const res = await fetch(`${TARGETS[mode].api}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Api-Version-Date": API_VERSION_DATE,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// Replaces NAME=... in .env.local (or appends it) without touching any other line.
function saveToEnvFile(name: string, value: string) {
  let content = "";
  try {
    content = readFileSync(ENV_FILE, "utf8");
  } catch {
    // Created below.
  }
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const line = new RegExp(`^${name}=.*$`, "m");
  content = line.test(content)
    ? content.replace(line, () => `${name}=${value}`)
    : `${content}${content && !content.endsWith(eol) ? eol : ""}${name}=${value}${eol}`;
  writeFileSync(ENV_FILE, content);
  process.env[name] = value;
}

async function countWebhookEvents(): Promise<number | null> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const [row] = await neon(url)`SELECT count(*)::int AS n FROM webhook_events`;
  return row.n as number;
}

async function setUp(mode: Mode) {
  const { secretVar, query } = TARGETS[mode];
  const url = `${base}/api/whop/webhook${query}`;
  console.log(`\n[${mode}] ${url}`);

  const me = await whop<{ id: string; title: string }>(mode, "/accounts/me");
  console.log(`  account: ${me.id} "${me.title}"`);

  const list = await whop<{ data: Webhook[] }>(mode, `/webhooks?account_id=${encodeURIComponent(me.id)}`);
  let hook = list.data.find((w) => w.url === url);
  const savedSecret = process.env[secretVar]?.trim();

  if (hook && replace) {
    await whop(mode, `/webhooks/${hook.id}`, { method: "DELETE" });
    console.log(`  deleted existing webhook ${hook.id}`);
    hook = undefined;
  } else if (hook && !savedSecret?.startsWith("ws_")) {
    // Whop returns the secret only on creation, so an existing webhook can't be recovered.
    throw new Error(
      `webhook ${hook.id} already exists but ${secretVar} is empty. ` +
        `Re-run with --replace, or copy its Secret from the Whop dashboard into ${ENV_FILE}.`,
    );
  }

  if (hook) {
    console.log(`  reusing webhook ${hook.id} (secret already in ${secretVar})`);
  } else {
    const request = { url, events: EVENTS, enabled: true, api_version_date: API_VERSION_DATE };
    let created: Webhook;
    try {
      created = await whop<Webhook>(mode, "/webhooks", { method: "POST", body: request });
    } catch (err) {
      if (!String(err).includes("api_version_date")) throw err;
      console.log("  version pin rejected; creating the webhook unpinned instead");
      created = await whop<Webhook>(mode, "/webhooks", {
        method: "POST",
        body: { ...request, api_version_date: undefined },
      });
    }
    if (!created.webhook_secret) throw new Error(`created ${created.id}, but the response had no webhook_secret`);
    saveToEnvFile(secretVar, created.webhook_secret);
    hook = created;
    console.log(`  created webhook ${created.id}; secret saved to ${secretVar} in ${ENV_FILE}`);
  }
  console.log(`  events: ${hook.events.join(", ")}; pinned to ${hook.api_version_date ?? "none"}`);

  const before = await countWebhookEvents().catch(() => null);
  const test = await whop<{ status: number; success: boolean; body?: unknown }>(mode, `/webhooks/${hook.id}/test`, {
    method: "POST",
    body: { event: "payment.succeeded" },
  });
  console.log(`  test event: our endpoint answered HTTP ${test.status} (${test.success ? "success" : "failed"})`);
  if (!test.success) console.log(`  endpoint body: ${JSON.stringify(test.body).slice(0, 300)}`);

  if (before !== null) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const after = await countWebhookEvents();
    console.log(`  webhook_events rows: ${before} -> ${after}`);
  }
  return test.success;
}

async function main() {
  let ok = true;
  for (const mode of modes) {
    try {
      ok = (await setUp(mode)) && ok;
    } catch (err) {
      ok = false;
      console.error(`  ❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(ok ? "\nDone." : "\nFinished with errors (see above).");
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error("whop-webhooks failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
