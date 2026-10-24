import { ZodError } from "zod";
import { TaskError } from "./task-service";

export const taskJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export function taskFailure(error: unknown) {
  if (error instanceof TaskError) return taskJson({ error: error.message }, error.status);
  if (error instanceof ZodError) return taskJson({ error: "Open this task from Terac and complete every field. Your reason must contain at least 10 words." }, 400);
  if (error instanceof SyntaxError) return taskJson({ error: "The response could not be read. Please try again." }, 400);
  return taskJson({ error: "Could not save your progress. Please try again; your earlier answers are safe." }, 503);
}
export function assertTaskOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  if (origin && new URL(origin).host !== host) throw new TaskError("Please submit from the review page.", 403);
}
