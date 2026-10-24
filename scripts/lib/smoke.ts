import { loadEnvConfig } from "@next/env";

export class SmokeCheckError extends Error {}

export function requireEnv(name: string): string {
  loadEnvConfig(process.cwd());
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SmokeCheckError(`Set ${name} in .env.local or the environment.`);
  }
  return value;
}

export async function runSmokeCheck(
  service: string,
  check: () => Promise<void>,
): Promise<void> {
  try {
    await check();
  } catch (error) {
    // Provider errors can include credentials or authenticated connection URLs.
    const message =
      error instanceof SmokeCheckError
        ? error.message
        : "Request or session failed. Check connectivity, API credentials, credits, and the provider dashboard.";
    console.error(`${service} FAILED: ${message}`);
    process.exitCode = 1;
  }
}
