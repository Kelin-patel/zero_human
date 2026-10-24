import { Suspense } from "react";
import TaskParams from "./task-params";

// Placeholder: Chaitanya is building the real task UI here.
export default function TaskPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Task</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Placeholder. The task UI will go here.
      </p>
      <Suspense fallback={<p className="text-sm text-zinc-500">Reading URL…</p>}>
        <TaskParams />
      </Suspense>
    </main>
  );
}
