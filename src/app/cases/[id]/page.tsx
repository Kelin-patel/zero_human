import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getCaseView } from "@/lib/repo";
import CaseStatus from "./case-status";

export const metadata: Metadata = {
  title: "Refund request status · Second Instance",
};

async function CaseLoader({ params }: Pick<PageProps<"/cases/[id]">, "params">) {
  const { id } = await params;
  const view = await getCaseView(id);
  if (!view) notFound();
  return <CaseStatus initial={view} />;
}

export default function CasePage({ params }: PageProps<"/cases/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <Suspense fallback={<p className="text-zinc-500">Loading your request…</p>}>
        <CaseLoader params={params} />
      </Suspense>
      <p className="text-sm text-zinc-500">
        <Link href="/refund" className="underline">
          Start another demo request
        </Link>
      </p>
    </main>
  );
}
