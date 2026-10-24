import { loadEnvConfig } from "@next/env";
import { neon, neonConfig } from "@neondatabase/serverless";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { getSql } from "../src/lib/db";
import { claimNextJob, enqueueJob } from "../src/lib/repo";
import { runWorker } from "../worker/runner";

loadEnvConfig(process.cwd());

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const originalUrl = process.env.DATABASE_URL;
  const originalFetch = neonConfig.fetchFunction;
  const admin = neon(originalUrl);
  const schema = `worker_check_${randomBytes(8).toString("hex")}`;
  // Identifiers are generated locally, never taken from a user or job payload.
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    await admin.query(`CREATE TABLE "${schema}".jobs (LIKE public.jobs INCLUDING ALL)`);
    await admin.query(`CREATE SEQUENCE "${schema}".job_ids`);
    await admin.query(`ALTER TABLE "${schema}".jobs ALTER COLUMN id SET DEFAULT nextval('"${schema}".job_ids')`);
    // HTTP requests have no persistent session. Set search_path transaction-locally in the
    // same batch as each real repository query, then unwrap its original response shape.
    neonConfig.fetchFunction = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const body = JSON.parse(String(init?.body));
      const batched = Array.isArray(body.queries);
      const payload = { queries: [
        { query: "SELECT set_config('search_path', $1, true)", params: [schema] },
        ...(batched ? body.queries : [body]),
      ] };
      const response = await (originalFetch ?? fetch)(input, { ...init, body: JSON.stringify(payload) });
      if (!response.ok) return response;
      const data = await response.json();
      return new Response(JSON.stringify(batched ? { ...data, results: data.results.slice(1) } : data.results[1]),
        { status: response.status, headers: { "content-type": "application/json" } });
    };
    const sql = getSql();
    const [current] = await sql`SELECT current_schema() AS name`;
    assert.equal(current.name, schema, "Connection must use the isolated test schema before any job is queued");

    const waiting = await enqueueJob("evidence");
    const done = await enqueueJob("provision");
    const stop = new AbortController();
    await runWorker({ provision: async job => { assert.equal(job.id, done); stop.abort(); } }, { signal: stop.signal });
    const [completed] = await sql`SELECT status, attempts FROM jobs WHERE id = ${done}`;
    assert.equal(completed.status, "done");
    assert.equal(completed.attempts, 1);
    const [unhandled] = await sql`SELECT status, attempts FROM jobs WHERE id = ${waiting}`;
    assert.equal(unhandled.status, "queued");
    assert.equal(unhandled.attempts, 0);

    const retryId = await enqueueJob("provision");
    for (let attempt = 1; attempt <= 5; attempt++) {
      const controller = new AbortController();
      await runWorker({ provision: async job => {
        assert.equal(job.id, retryId);
        controller.abort();
        throw new Error("Intentional worker retry check");
      } }, { signal: controller.signal });
      const [row] = await sql`SELECT status, attempts, last_error, extract(epoch FROM (run_after - now())) AS delay FROM jobs WHERE id = ${retryId}`;
      assert.equal(row.attempts, attempt);
      assert.equal(row.status, attempt < 5 ? "queued" : "failed");
      assert.match(row.last_error, /Intentional worker retry check/);
      if (attempt < 5) {
        assert.ok(Number(row.delay) > attempt * 30 - 5 && Number(row.delay) <= attempt * 30);
        // Advance only this test row instead of waiting for every backoff period.
        await sql`UPDATE jobs SET run_after = now() WHERE id = ${retryId}`;
      }
    }

    const raceId = await enqueueJob("provision");
    const claims = await Promise.all([claimNextJob(["provision"]), claimNextJob(["provision"])]);
    assert.deepEqual(claims.filter(Boolean).map(job => job!.id), [raceId]);
    console.log("Worker database checks passed: done, unhandled jobs, retries, final failure and atomic claiming.");
  } finally {
    neonConfig.fetchFunction = originalFetch;
    // This schema contains only rows created by this script.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log("Isolated worker test data removed.");
  }
}

main().catch(error => {
  console.error("Worker check failed:", error instanceof Error ? error.name : "unknown error");
  process.exitCode = 1;
});
