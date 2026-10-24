import { z } from "zod";
import { approveLaunch } from "./governor";

export const PROJECT_ID = "v0mobx42h3c2twnu99hbb68k";
export const STOP_AT = "2026-10-24T17:30:00-04:00";
type Data = Record<string, unknown>;
export function object(value: unknown): Data {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a Terac response object.");
  return value as Data;
}
function optionalObject(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}; }
function toolData(value: unknown): unknown {
  let data = value;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof data === "string") { data = JSON.parse(data); continue; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return data;
    const row = data as Data;
    if (row.structuredContent) { data = row.structuredContent; continue; }
    if (Array.isArray(row.content) && row.content.length === 1 && row.content[0]?.type === "text") { data = row.content[0].text; continue; }
    return data;
  }
  throw new Error("Terac response nesting exceeded the supported boundary.");
}
function cents(...values: unknown[]): number {
  const known = values.filter(value => value !== undefined && value !== null);
  if (!known.length || known.some(value => !Number.isSafeInteger(value) || Number(value) < 0)) throw new Error("Terac must supply explicit integer-cent pricing and balance fields.");
  if (new Set(known).size !== 1) throw new Error("Terac cent amounts disagree; inspect the raw quote.");
  return Number(known[0]);
}

export function opportunityObject(value: unknown): Data {
  let data = object(toolData(value));
  if (data.data && !Array.isArray(data.data)) data = object(data.data);
  return object(data.opportunity ?? data.draft ?? data);
}

export function balanceFromContext(raw: unknown): number {
  const data = object(toolData(raw));
  const org = optionalObject(data.organization ?? data.org);
  const billing = optionalObject(data.billing);
  const dollars = data.balanceDollars;
  const dollarsInCents = typeof dollars === "number" && Number.isFinite(dollars) && dollars >= 0 && Math.abs(dollars * 100 - Math.round(dollars * 100)) < 0.000001 ? Math.round(dollars * 100) : undefined;
  return cents(data.balance_cents, org.balance_cents, org.credit_balance_cents, billing.balance_cents, dollarsInCents);
}

export function parseOpportunity(raw: unknown) {
  const data = opportunityObject(raw);
  const id = z.string().min(1).parse(data.id ?? data.opportunity_id);
  const projectId = data.project_id ?? optionalObject(data.project).id;
  if (projectId !== PROJECT_ID) throw new Error("Opportunity belongs to a different or unverifiable Terac project.");
  const pricing = object(data.pricing);
  const funding = optionalObject(data.funding);
  const n = z.number().int().min(8).max(11).parse(data.num_participants);
  const cpiCents = cents(pricing.cpi_cents, pricing.cost_per_participant_cents, pricing.estimated_cpi_cents);
  const totalCents = cents(pricing.total_cents, pricing.estimated_total_cents, pricing.total_cost_cents);
  const affordable = data.status === "draft" ? z.boolean().parse(funding.affordable) : funding.affordable === true;
  const tasks = z.array(z.record(z.string(), z.unknown())).length(1).parse(data.tasks);
  const task = tasks[0];
  if (task.task_type !== "interview" || ![5, 7].includes(Number(task.duration_minutes)) || typeof task.duration_minutes !== "number") throw new Error("Unexpected review task type or duration.");
  const taskUrl = z.string().url().parse(task.task_url);
  const reviewType = z.enum(["auto_approve", "self_report", "manual_review"]).parse(task.review_type);
  const callbackValue = task.completion_url ?? task.completion_callback_url ?? task.callback_url ?? task.completion_redirect_url;
  const completionUrl = callbackValue == null ? null : z.string().url().parse(callbackValue);
  if (completionUrl && (new URL(completionUrl).protocol !== "https:" || (new URL(completionUrl).hostname !== "terac.com" && !new URL(completionUrl).hostname.endsWith(".terac.com")))) throw new Error("Completion URL must use HTTPS on Terac.");
  const links = optionalObject(data.links);
  const dashboard = optionalObject(links.dashboard);
  return { id, projectId, n, cpiCents, totalCents, affordable, durationMinutes: Number(task.duration_minutes),
    cardsPerReviewer: task.duration_minutes === 5 ? 6 : 8, taskUrl, reviewType, completionUrl,
    draftEditorUrl: dashboard.draft_editor ?? null, submissionsUrl: dashboard.submissions ?? null,
    apiSubmissionsUrl: typeof links.submissions === "string" ? new URL(links.submissions, "https://terac.com").toString()
      : optionalObject(links.api).submissions ?? `https://terac.com/api/external/v2/opportunities/${encodeURIComponent(id)}/submissions`, status: data.status ?? null };
}

export function draftAdjustment(plan: ReturnType<typeof parseOpportunity>, balanceCents: number) {
  const lowerDuration = plan.durationMinutes === 7 && plan.cpiCents > 900;
  const approval = approveLaunch(plan, { affordable: plan.affordable }, balanceCents);
  const n = lowerDuration ? 11 : !approval.ok && approval.n >= 8 ? approval.n : plan.n;
  const durationMinutes = lowerDuration ? 5 : plan.durationMinutes;
  const reviewType = plan.reviewType === "manual_review" ? "manual_review" : plan.completionUrl ? "auto_approve" : "self_report";
  return n !== plan.n || durationMinutes !== plan.durationMinutes || reviewType !== plan.reviewType
    ? { n, durationMinutes, reviewType } : null;
}

export interface SubmissionStatus { id: string; status: string }
export function submissionStatuses(raw: unknown): SubmissionStatus[] {
  const decoded = toolData(raw);
  const data = Array.isArray(decoded) ? decoded : object(decoded).submissions ?? object(decoded).data;
  const rows = z.array(z.record(z.string(), z.unknown())).parse(data);
  return rows.map(row => ({ id: z.string().min(1).parse(row.id ?? row.submission_id), status: z.string().min(1).parse(row.status) }));
}

export async function readSubmissionStatuses(url: string, key: string): Promise<SubmissionStatus[]> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || (parsed.hostname !== "terac.com" && !parsed.hostname.endsWith(".terac.com")) || parsed.username || parsed.password) {
    throw new Error("Only an HTTPS read endpoint returned by Terac may receive the Terac API key.");
  }
  const statuses: SubmissionStatus[] = [];
  let next: string | null = parsed.toString();
  const seen = new Set<string>();
  while (next) {
    const pageUrl: URL = new URL(next, parsed);
    if (pageUrl.origin !== parsed.origin || pageUrl.username || pageUrl.password || seen.has(pageUrl.toString()) || seen.size >= 20) throw new Error("Unsafe or incomplete Terac pagination.");
    seen.add(pageUrl.toString());
    const response: Response = await fetch(pageUrl, { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Terac status read returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    statuses.push(...submissionStatuses(body));
    const root: Data = Array.isArray(body) ? {} : object(body);
    const pagination = optionalObject(root.pagination);
    const nextValue: unknown = optionalObject(root.links).next ?? pagination.next_url ?? root.next_url;
    if (pagination.has_more === true && typeof pagination.next_cursor === "string") {
      const following = new URL(parsed); following.searchParams.set("cursor", pagination.next_cursor); next = following.toString();
    } else {
      if ((root.has_more === true || pagination.has_more === true) && typeof nextValue !== "string") throw new Error("Pagination requires a next cursor or page URL; use MCP fallback.");
      next = typeof nextValue === "string" ? nextValue : null;
    }
  }
  return statuses;
}
