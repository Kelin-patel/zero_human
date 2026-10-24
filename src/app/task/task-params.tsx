"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export const SUBMISSION_ID_KEY = "teracSubmissionId";
export const TASK_ID_KEY = "taskId";

export default function TaskParams() {
  const searchParams = useSearchParams();
  const submissionId =
    searchParams.get("teracSubmissionId") ?? searchParams.get("submissionId");
  const taskId = searchParams.get("taskId");

  useEffect(() => {
    try {
      if (submissionId) localStorage.setItem(SUBMISSION_ID_KEY, submissionId);
      if (taskId) localStorage.setItem(TASK_ID_KEY, taskId);
    } catch {
      // localStorage can be unavailable (private mode, blocked storage); the page still works.
    }
  }, [submissionId, taskId]);

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-mono text-sm">
      <dt className="text-zinc-500">submissionId</dt>
      <dd className="break-all">{submissionId ?? "(missing)"}</dd>
      <dt className="text-zinc-500">taskId</dt>
      <dd className="break-all">{taskId ?? "(missing)"}</dd>
    </dl>
  );
}
