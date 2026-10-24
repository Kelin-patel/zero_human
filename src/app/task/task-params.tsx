"use client";

import { useSearchParams } from "next/navigation";

export const SUBMISSION_ID_KEY = "teracSubmissionId";
export const TASK_ID_KEY = "taskId";

export function useTaskIdentity() {
  const params = useSearchParams();
  return {
    submissionId: params.get(SUBMISSION_ID_KEY) ?? params.get("submissionId") ?? "",
    taskId: params.get(TASK_ID_KEY) ?? "",
  };
}
