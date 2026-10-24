import type { Metadata } from "next";
import { loadPolicy } from "@/lib/policy";

export const metadata: Metadata = {
  title: "Refund policy | Example Academy (fictional)",
  robots: { index: false, follow: false },
};

// The fictional store's published terms: the frozen refund policy, rendered as plain text blocks.
export default function DemoTerms() {
  const blocks = loadPolicy().text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-12">
      <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Prepared demo: Example Academy is a fictional store used to demonstrate refund reviews.
      </p>
      {blocks.map((block, i) => {
        const heading = /^(#{1,3})\s+(.*)$/u.exec(block);
        if (heading && !block.includes("\n")) {
          return heading[1] === "#" ? (
            <h1 key={i} className="text-3xl font-semibold tracking-tight">{heading[2]}</h1>
          ) : (
            <h2 key={i} className="pt-2 text-xl font-semibold">{heading[2]}</h2>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {block}
          </p>
        );
      })}
    </main>
  );
}
