import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Course | Example Academy (fictional)",
  robots: { index: false, follow: false },
};

const MODULES = [
  "Getting started and setting up your workspace",
  "Planning a small project",
  "Building the first version",
  "Testing with real users",
  "Shipping and measuring results",
  "Next steps and further reading",
];

// A working course page for the fictional demo store: access checks against it return HTTP 200.
export default function DemoCourseOk() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Prepared demo: Example Academy is a fictional store used to demonstrate refund reviews.
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">Example Academy: Practical Projects Course</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Your course is available. Pick up where you left off, or start from Module 1.
      </p>
      <ol className="flex flex-col gap-2">
        {MODULES.map((title, i) => (
          <li key={title} className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <span className="text-sm text-zinc-500">Module {i + 1}</span>
            <p className="font-medium">{title}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
