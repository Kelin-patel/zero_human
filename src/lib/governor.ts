export interface LaunchQuote { cpiCents: number; n: number; totalCents: number }
export interface LaunchApproval { ok: boolean; n: number; reason: string }
export const RESERVE_CENTS = 1000;
export const MIN_REVIEWERS = 8;

// Reductions are proposals: a changed participant count must be re-quoted and registered.
export function approveLaunch(quote: LaunchQuote, funding: { affordable: boolean }, balanceCents: number): LaunchApproval {
  const valid = [quote.cpiCents, quote.n, quote.totalCents, balanceCents].every(Number.isSafeInteger) &&
    quote.cpiCents > 0 && quote.n >= MIN_REVIEWERS && quote.totalCents >= quote.cpiCents * quote.n && balanceCents >= 0;
  if (!valid) return { ok: false, n: 0, reason: "Invalid or incomplete integer-cent quote, balance or participant count." };
  const available = balanceCents - RESERVE_CENTS;
  if (quote.totalCents <= available && funding.affordable === true) {
    return { ok: true, n: quote.n, reason: `The quoted total fits the available balance with ${RESERVE_CENTS} cents reserved.` };
  }
  const overhead = quote.totalCents - quote.cpiCents * quote.n;
  const proposed = Math.min(quote.n - 1, Math.floor((available - overhead) / quote.cpiCents));
  if (proposed >= MIN_REVIEWERS) return { ok: false, n: proposed, reason: "Reduce to this participant count, obtain a new affordable quote, and register the revised assignments before launch." };
  return { ok: false, n: 0, reason: "The provider rejected funding or fewer than eight reviewers fit while preserving the reserve." };
}
