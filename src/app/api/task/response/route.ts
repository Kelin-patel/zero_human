import { identityFrom } from "@/lib/task-contract";
import { assertTaskOrigin, taskFailure, taskJson } from "@/lib/task-http";
import { saveTaskResponse } from "@/lib/task-service";

export async function POST(request: Request) {
  try {
    assertTaskOrigin(request);
    const body = await request.text();
    if (body.length > 12000) return taskJson({ error: "Please shorten your reason." }, 413);
    const input = JSON.parse(body);
    return taskJson(await saveTaskResponse({ ...input, ...identityFrom(request, input) }));
  } catch (error) { return taskFailure(error); }
}
