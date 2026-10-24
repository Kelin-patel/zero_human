import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadPolicy(): { text: string; sha256: string } {
  const text = readFileSync(resolve(process.cwd(), "data/policy.v1.md"), "utf8")
    .replace(/\r\n?/g, "\n");
  return { text, sha256: createHash("sha256").update(text, "utf8").digest("hex") };
}
