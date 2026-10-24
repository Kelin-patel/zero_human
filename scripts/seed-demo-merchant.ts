import { loadEnvConfig } from "@next/env";
import { seedDemoMerchant } from "../src/lib/demo-seed";

async function main() {
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("Set DATABASE_URL in .env.local before seeding the demo merchant.");
  }
  const result = await seedDemoMerchant();
  console.log(JSON.stringify(result));
}

void main().catch(() => {
  console.error("Demo seeding failed. Check DATABASE_URL, run the database migration, and confirm the existing demo policy matches the local frozen policy. No connection string was logged.");
  process.exitCode = 1;
});
