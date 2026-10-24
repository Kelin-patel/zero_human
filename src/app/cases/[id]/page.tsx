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
    <div className="container-page py-10 sm:py-14">
      <div className="flex flex-col gap-8">
        <Suspense fallback={<p className="text-sm text-ink-3">Loading your request…</p>}>
          <CaseLoader params={params} />
        </Suspense>
        <p className="text-sm">
          <Link href="/refund" className="link">
            Start another demo request
          </Link>
        </p>
      </div>
    </div>
  );
}
