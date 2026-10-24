import { identityFrom } from "@/lib/task-contract";
import { assertTaskOrigin, taskFailure, taskJson } from "@/lib/task-http";
import { getTaskSession } from "@/lib/task-service";

export async function POST(request: Request) {
  try {
    assertTaskOrigin(request);
    const input = await request.json();
    return taskJson(await getTaskSession(identityFrom(request, input)));
  } catch (error) { return taskFailure(error); }
}
