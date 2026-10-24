import { z } from "zod";
import type { CaseCard } from "./case-schema";

export const TaskIdentity = z.object({
  submissionId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
  taskId: z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/),
});
export type TaskIdentity = z.infer<typeof TaskIdentity>;
export const wordCount = (value: string): number => (value.trim().match(/[\p{L}\p{N}]+(?:['’’-][\p{L}\p{N}]+)*/gu) ?? []).length;
export const TaskResponse = TaskIdentity.extend({
  caseId: z.string().min(1).max(100),
  decision: z.enum(["approve", "deny", "need_more_evidence"]),
  reason: z.string().trim().max(3000).refine(v => wordCount(v) >= 10, "Please write at least 10 words."),
  confidence: z.number().int().min(1).max(5),
  secondsSpent: z.number().int().min(0).max(7200),
}).strict();

export type TaskSession = {
  total: number; completed: number; card: CaseCard | null;
  policy: { text: string; summary: [string, string][] };
  completionUrl: string | null; isTest: boolean;
};

export function identityFrom(request: Request, input: Record<string, unknown> = {}): TaskIdentity {
  const own = new URL(request.url).searchParams;
  let referer = new URLSearchParams();
  try { referer = new URL(request.headers.get("referer") ?? "").searchParams; } catch { /* A missing referrer is normal. */ }
  return TaskIdentity.parse({
    submissionId: input.submissionId ?? own.get("teracSubmissionId") ?? own.get("submissionId") ?? referer.get("teracSubmissionId") ?? referer.get("submissionId"),
    taskId: input.taskId ?? own.get("taskId") ?? referer.get("taskId"),
  });
}

export function resolveCompletionUrl(template: string, identity: TaskIdentity): string {
  let value = template;
  for (const [key, id] of Object.entries({ teracSubmissionId: identity.submissionId, submissionId: identity.submissionId, taskId: identity.taskId })) {
    value = value.replaceAll(`{${key}}`, encodeURIComponent(id));
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || /[{}]/.test(value)) throw new Error("Invalid completion callback configuration.");
  return url.toString();
}
