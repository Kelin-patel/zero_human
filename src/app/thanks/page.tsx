import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Purchase confirmed · Second Instance",
};

const NEXT_STEPS = [
  "Whop has emailed you a receipt for this purchase.",
  "We'll write to the same address to set up your independent reviews.",
  "The sale is booked to the public ledger from Whop's verified webhook, not from this page.",
];

// Whop sends buyers here after checkout. The sale itself is booked from the verified webhook, not this page.
export default function ThanksPage() {
  return (
    <div className="container-page flex flex-1 items-center justify-center py-14 sm:py-20">
      <section className="panel flex w-full max-w-lg flex-col gap-6 p-6 sm:p-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ok-soft text-ok">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink">Payment received</h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Thanks, your purchase is confirmed. Whop has emailed you a receipt. We&apos;ll follow up at the same address to
            set up your independent reviews.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-rule pt-5">
          <h2 className="text-sm font-medium text-ink">What happens next</h2>
          <ol className="flex flex-col gap-3">
            {NEXT_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-subtle font-mono text-xs text-ink">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn-primary">Back to home</Link>
          <Link href="/ledger" className="btn-secondary">View the ledger</Link>
        </div>
      </section>
    </div>
  );
}
