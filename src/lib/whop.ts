import { WhopClient, WhopEnvironment } from "@whop/sdk";

export type WhopEnv = "live" | "sandbox";

// Same dated API version the webhooks are pinned to, so API reads and webhook payloads share one shape.
export const WHOP_API_VERSION_DATE = "2026-10-15-1";

const clients: Partial<Record<WhopEnv, WhopClient>> = {};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The Whop client for one environment. Prepared and demo money moves only in the sandbox. */
export function whop(env: WhopEnv): WhopClient {
  // The SDK reads no environment variables itself; without a token it sends unauthenticated requests.
  const token = requireEnv(env === "live" ? "WHOP_API_KEY" : "WHOP_SANDBOX_API_KEY");
  const client =
    clients[env] ??
    new WhopClient({
      token,
      environment: env === "live" ? WhopEnvironment.Production : WhopEnvironment.Sandbox,
      apiVersionDate: WHOP_API_VERSION_DATE,
    });
  clients[env] = client;
  return client;
}

/** Our own business account (`biz_…`) in the given environment. */
export function whopAccountId(env: WhopEnv): string {
  return requireEnv(env === "live" ? "WHOP_BUSINESS_ID" : "WHOP_SANDBOX_BUSINESS_ID");
}

export function parseWhopEnv(value: unknown): WhopEnv {
  return value === "sandbox" ? "sandbox" : "live";
}

/** Converts Whop's exact decimal string (e.g. "29.00") to integer cents without float rounding. */
export function moneyToCents(money: { amount: string } | null | undefined): number | null {
  const match = money?.amount.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(3, "0").slice(0, 3)) / 10;
  return (sign ? -1 : 1) * Math.round(cents);
}
