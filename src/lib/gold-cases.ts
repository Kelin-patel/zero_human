import { CaseRecord } from "./case-schema";
import { NEUTRAL_POSITION } from "./case-generation";

export function goldCases(baseUrl: string): CaseRecord[] {
  const make = (index: number, purchased: string, days: number, statement: string, text: string,
    records: Partial<CaseRecord["card"]["records"]>, decision: "approve" | "deny"): CaseRecord => CaseRecord.parse({
    card: {
      id: `case_gold_${index}`,
      product: "Intro to Product Design (video course)",
      price_usd: 79,
      purchased,
      requested: "2026-10-24",
      days_since_purchase: days,
      records: {
        progress_pct: 0,
        bonus_files_downloaded: false,
        certificate_issued: false,
        prior_refunds_for_this_course: 0,
        access_check: { url: `${baseUrl}/demo/course/ok`, http_status: 200, checked_at: "2026-10-24T12:00:00-04:00" },
        ...records,
      },
      customer_statement: statement,
      store_position: NEUTRAL_POSITION,
      evidence: [{ kind: "store_record", text, url: `${baseUrl}/demo/terms` }],
    },
    set_name: "gold",
    expected: { decision },
  });
  return [
    make(1, "2026-10-23", 1,
      "I paid twice for the same course yesterday. Please refund the extra charge.",
      "Prepared payment records show two separate $79 charges for the same course on October 23, 2026. This request concerns only the duplicate charge.",
      { duplicate_charge: true }, "approve"),
    make(2, "2026-03-28", 210,
      "I completed this course months ago and received my certificate. I have changed my mind about keeping it; there is no content defect.",
      "Prepared purchase records show a March 28, 2026 purchase and an issued completion certificate. No delivery or description problem has been reported.",
      { progress_pct: 100, certificate_issued: true, bonus_files_downloaded: true }, "deny"),
    make(3, "2026-10-21", 3,
      "I bought this course three days ago but changed my mind. I have not started any lessons or downloaded bonus files.",
      "Prepared store records confirm 0% lesson progress and no bonus downloads since purchase.",
      {}, "approve"),
    make(4, "2026-10-01", 23,
      "The videos will not play on my laptop. I am using an outdated browser that the course does not support. Please refund my purchase.",
      "Prepared support records show the videos play in a supported browser. The access check returned HTTP 200. The customer confirms using an outdated browser. No store-side defect was found.",
      { progress_pct: 35 }, "deny"),
  ];
}
