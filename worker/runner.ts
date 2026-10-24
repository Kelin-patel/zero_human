import { setTimeout as sleep } from "node:timers/promises";
import { claimNextJob, finishJob, failJob, type JobKind, type JobRow } from "../src/lib/repo";

export type JobHandlers = Partial<Record<JobKind, (job: JobRow) => Promise<void>>>;
export interface JobRepository {
  claimNextJob(kinds: JobKind[]): Promise<JobRow | null>;
  finishJob(id: number): Promise<void>;
  failJob(id: number, error: string): Promise<void>;
}
interface WorkerOptions {
  signal: AbortSignal;
  pollMs?: number;
  repository?: JobRepository;
  log?: (message: string) => void;
}

function errorMessage(error: unknown): string {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : "Handler threw a non-Error value";
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:KEY|TOKEN|SECRET|SALT|DATABASE_URL)/.test(key) && value && value.length >= 8) {
      message = message.split(value).join("[redacted]");
    }
  }
  return message.slice(0, 2000);
}

export async function runWorker(handlers: JobHandlers, options: WorkerOptions): Promise<void> {
  const repository = options.repository ?? { claimNextJob, finishJob, failJob };
  const log = options.log ?? console.log;
  const kinds = (Object.keys(handlers) as JobKind[]).filter(kind => typeof handlers[kind] === "function");
  if (kinds.length === 0) throw new Error("The worker needs at least one registered handler.");
  const pollMs = options.pollMs ?? 5000;
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error("Invalid worker polling interval.");
  const pause = async () => {
    try { await sleep(pollMs, undefined, { signal: options.signal }); }
    catch (error) { if (!options.signal.aborted) throw error; }
  };

  while (!options.signal.aborted) {
    let job: JobRow | null;
    try { job = await repository.claimNextJob(kinds); }
    catch (error) {
      log(`[worker] claim failed: ${errorMessage(error)}`);
      await pause();
      continue;
    }
    if (!job) { await pause(); continue; }
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler registered for ${job.kind}`);
      await handler(job);
    } catch (error) {
      const message = errorMessage(error);
      // If failure recording fails, stop: silently continuing would strand a running job.
      await repository.failJob(job.id, message);
      log(`[worker] ${job.kind} #${job.id} attempt=${job.attempts} failed: ${message}`);
      continue;
    }
    // Acknowledgement errors must not be treated as handler failures and re-run side effects.
    await repository.finishJob(job.id);
    log(`[worker] ${job.kind} #${job.id} done`);
  }
}
