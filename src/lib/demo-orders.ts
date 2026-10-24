import { CaseCard } from "./case-schema";

// Prepared orders for the fictional demo store. A visitor picks one and writes their own statement;
// dates are set relative to the request so the records stay realistic on any day.

export interface DemoOrder {
  id: string;
  product: string;
  priceUsd: number;
  daysSincePurchase: number;
  summary: string;
  suggestedStatement: string;
  records: {
    progressPct: number;
    bonusFilesDownloaded: boolean;
    certificateIssued: boolean;
    priorRefunds: number;
    accessPath: "/demo/course/ok" | "/demo/course/broken";
  };
  evidence: (facts: { purchased: string; requested: string; charge: string }) => { kind: string; text: string; path: string }[];
}

export const DEMO_ORDERS: DemoOrder[] = [
  {
    id: "spreadsheets",
    product: "Spreadsheet Automation for Small Teams (video course)",
    priceUsd: 49,
    daysSincePurchase: 5,
    summary: "Bought 5 days ago, 8% watched, no bonus downloads.",
    suggestedStatement:
      "I bought this to automate our invoicing, but it covers basics I already know. I've only watched the first two lessons and haven't downloaded anything. Please refund me.",
    records: { progressPct: 8, bonusFilesDownloaded: false, certificateIssued: false, priorRefunds: 0, accessPath: "/demo/course/ok" },
    evidence: ({ purchased, charge }) => [
      { kind: "progress_record", text: "Account progress shows 8% complete: 2 of 25 lessons finished.", path: "/demo/course/ok" },
      { kind: "download_log", text: "The bonus templates bundle has zero download events on this purchase.", path: "/demo/course/ok" },
      { kind: "order_record", text: `A single charge of ${charge} on ${purchased}. No prior refunds for this course.`, path: "/demo/terms" },
    ],
  },
  {
    id: "copywriting",
    product: "Copywriting Fundamentals (video course)",
    priceUsd: 79,
    daysSincePurchase: 18,
    summary: "Bought 18 days ago, 30% watched. Customer reports Module 4 videos won't play.",
    suggestedStatement:
      "The Module 4 videos never load for me, on my laptop or my phone. I reported it to support 3 days ago and nothing has changed. I can't finish the course I paid for.",
    records: { progressPct: 30, bonusFilesDownloaded: false, certificateIssued: false, priorRefunds: 0, accessPath: "/demo/course/ok" },
    evidence: ({ purchased, requested, charge }) => [
      { kind: "progress_record", text: "Account progress shows 30% complete: Modules 1-3 finished, no lessons in Modules 4-6 completed.", path: "/demo/course/ok" },
      { kind: "support_ticket", text: `A support ticket about Module 4 videos was opened 3 days before ${requested}. It has no reply and no recorded fix.`, path: "/demo/terms" },
      { kind: "access_check", text: "The course landing page returned HTTP 200. The check did not open individual Module 4 videos.", path: "/demo/course/ok" },
      { kind: "order_record", text: `A single charge of ${charge} on ${purchased}. No prior refunds for this course.`, path: "/demo/terms" },
    ],
  },
  {
    id: "photography",
    product: "Intro to Product Photography (video course)",
    priceUsd: 59,
    daysSincePurchase: 10,
    summary: "Bought 10 days ago, 12% watched. The course page returns an error.",
    suggestedStatement:
      "Since last week the course page just shows an error and I can't watch anything. I reported it four days ago. I'd like my money back.",
    records: { progressPct: 12, bonusFilesDownloaded: false, certificateIssued: false, priorRefunds: 0, accessPath: "/demo/course/broken" },
    evidence: ({ requested }) => [
      { kind: "access_check", text: `An automated access check on ${requested} returned HTTP 404 for the course page.`, path: "/demo/course/broken" },
      { kind: "support_ticket", text: "A defect report about the course page was filed 4 days before the request. No fix is recorded.", path: "/demo/terms" },
    ],
  },
  {
    id: "dashboards",
    product: "Excel Dashboards Masterclass (video course)",
    priceUsd: 99,
    daysSincePurchase: 21,
    summary: "Bought 21 days ago, 96% watched, certificate issued.",
    suggestedStatement:
      "I finished the course but honestly it didn't help me at work as much as I hoped. I'd like a refund.",
    records: { progressPct: 96, bonusFilesDownloaded: true, certificateIssued: true, priorRefunds: 0, accessPath: "/demo/course/ok" },
    evidence: ({ purchased, charge }) => [
      { kind: "progress_record", text: "Account progress shows 96% complete. A completion certificate was issued.", path: "/demo/course/ok" },
      { kind: "order_record", text: `A single charge of ${charge} on ${purchased}. No prior refunds for this course.`, path: "/demo/terms" },
    ],
  },
];

export const MAX_STATEMENT_CHARS = 600;

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Builds the case card for a visitor's request on one demo order. `priceUsd` replaces the list price when the
 * request is backed by a real payment, so every record on the card states the amount actually charged.
 */
export function buildDemoCard(
  order: DemoOrder,
  caseId: string,
  statement: string,
  baseUrl: string,
  { now = new Date(), priceUsd = order.priceUsd }: { now?: Date; priceUsd?: number } = {},
): CaseCard {
  const purchasedAt = new Date(now.getTime() - order.daysSincePurchase * 24 * 60 * 60 * 1000);
  const dates = { purchased: isoDate(purchasedAt), requested: isoDate(now) };
  const charge = `${priceUsd.toFixed(2)} USD`;
  const url = (path: string) => `${baseUrl}${path}`;
  return CaseCard.parse({
    id: caseId,
    product: order.product,
    price_usd: priceUsd,
    purchased: dates.purchased,
    requested: dates.requested,
    days_since_purchase: order.daysSincePurchase,
    records: {
      progress_pct: order.records.progressPct,
      bonus_files_downloaded: order.records.bonusFilesDownloaded,
      certificate_issued: order.records.certificateIssued,
      prior_refunds_for_this_course: order.records.priorRefunds,
      access_check: {
        url: url(order.records.accessPath),
        http_status: order.records.accessPath === "/demo/course/broken" ? 404 : 200,
        checked_at: now.toISOString(),
      },
      duplicate_charge: false,
      disputed: false,
    },
    customer_statement: statement,
    store_position: "The store has not approved this refund.",
    evidence: order.evidence({ ...dates, charge }).map((e) => ({ kind: e.kind, text: e.text, url: url(e.path) })),
  });
}
