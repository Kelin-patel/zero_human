import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Purchase confirmed · Second Instance",
};

// Whop sends buyers here after checkout. The sale itself is booked from the verified webhook, not this page.
export default function ThanksPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Thanks, your purchase is confirmed.</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Whop has emailed you a receipt. We&apos;ll follow up at the same address to set up your independent
        reviews.
      </p>
    </main>
  );
}
