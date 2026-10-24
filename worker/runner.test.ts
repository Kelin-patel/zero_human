import assert from "node:assert/strict";
import { test } from "node:test";
import { type JobRow } from "../src/lib/repo";
import { runWorker, type JobRepository } from "./runner";

const job: JobRow = { id: 10, kind: "provision", case_id: null, payload: {}, status: "running", attempts: 1, run_after: "", last_error: null, created_at: "" };

test("claims only registered kinds and acknowledges the active job after shutdown", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const repository: JobRepository = {
    async claimNextJob(kinds) { assert.deepEqual(kinds, ["provision"]); events.push("claim"); return job; },
    async finishJob(id) { assert.equal(id, job.id); events.push("finish"); },
    async failJob() { assert.fail("Successful jobs must not be requeued"); },
  };
  await runWorker({ provision: async () => { events.push("start"); controller.abort(); await Promise.resolve(); events.push("end"); } },
    { signal: controller.signal, repository, log: () => {} });
  assert.deepEqual(events, ["claim", "start", "end", "finish"]);
});

test("handler failure is recorded for retry and the next queued job can succeed", async () => {
  const controller = new AbortController();
  let claims = 0;
  const failed: number[] = [];
  const finished: number[] = [];
  const repository: JobRepository = {
    async claimNextJob() { return { ...job, id: ++claims }; },
    async finishJob(id) { finished.push(id); },
    async failJob(id, error) { assert.match(error, /intentional/); failed.push(id); },
  };
  await runWorker({ provision: async item => { if (item.id === 1) throw new Error("intentional"); controller.abort(); } },
    { signal: controller.signal, repository, log: () => {} });
  assert.deepEqual(failed, [1]);
  assert.deepEqual(finished, [2]);
});

test("idle shutdown interrupts the polling wait", async () => {
  const controller = new AbortController();
  const repository: JobRepository = { async claimNextJob() { setImmediate(() => controller.abort()); return null; },
    async finishJob() { assert.fail(); }, async failJob() { assert.fail(); } };
  await runWorker({ provision: async () => {} }, { signal: controller.signal, pollMs: 60000, repository, log: () => {} });
});

test("acknowledgement errors stop the worker without retrying completed side effects", async () => {
  const controller = new AbortController();
  const repository: JobRepository = { async claimNextJob() { return job; },
    async finishJob() { throw new Error("acknowledgement unavailable"); },
    async failJob() { assert.fail("Do not requeue an already completed handler"); } };
  await assert.rejects(runWorker({ provision: async () => {} }, { signal: controller.signal, repository, log: () => {} }), /acknowledgement unavailable/);
});
