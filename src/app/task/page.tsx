import { Suspense } from "react";
import type { Metadata } from "next";
import TaskReview from "./task-review";

export const metadata: Metadata = { title: "Review refund disputes | Second Instance", robots: { index: false, follow: false }, referrer: "same-origin" };
export default function TaskPage() {
  return <main className="min-h-screen bg-slate-50 text-slate-950"><Suspense fallback={<p className="p-8">Loading your review…</p>}><TaskReview /></Suspense></main>;
}
