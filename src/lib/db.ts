import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | undefined;

// Created lazily so builds and pages that never touch the DB don't need DATABASE_URL.
export function getSql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = neon(url);
  }
  return client;
}
