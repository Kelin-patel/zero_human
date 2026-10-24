import { z } from "zod";

export const Category = z.enum([
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10",
]);
export type Category = z.infer<typeof Category>;

export const Decision = z.enum(["approve", "deny", "out_of_scope"]);
export type Decision = z.infer<typeof Decision>;

const BinaryDecision = z.enum(["approve", "deny"]);

// Parsing a card removes private metadata before it crosses a reviewer boundary.
export const CaseCard = z.object({
  id: z.string().min(1),
  product: z.string().min(1),
  price_usd: z.number().finite().nonnegative(),
  purchased: z.string().min(1),
  requested: z.string().min(1),
  days_since_purchase: z.number().int().nonnegative(),
  records: z.object({
    progress_pct: z.number().min(0).max(100),
    bonus_files_downloaded: z.boolean(),
    certificate_issued: z.boolean(),
    prior_refunds_for_this_course: z.number().int().nonnegative(),
    access_check: z.object({
      url: z.string().url(),
      http_status: z.number().int().min(100).max(599),
      checked_at: z.string().min(1),
    }),
    membership_renewal_at: z.string().min(1).optional(),
    duplicate_charge: z.boolean().optional(),
    disputed: z.boolean().optional(),
  }),
  customer_statement: z.string().min(1).max(600),
  store_position: z.string().min(1),
  evidence: z.array(z.object({
    kind: z.string().min(1),
    text: z.string().min(1),
    url: z.string().url(),
  })),
});
export type CaseCard = z.infer<typeof CaseCard>;

export const CaseHidden = z.object({
  designer_clause: z.string().min(1),
  designer_intent: BinaryDecision,
  category: Category,
});
export type CaseHidden = z.infer<typeof CaseHidden>;

export const CaseRecord = z.object({
  card: CaseCard,
  set_name: z.enum(["dev", "eval", "gold", "live", "demo"]),
  hidden: CaseHidden.optional(),
  expected: z.object({ decision: BinaryDecision }).optional(),
}).superRefine((record, context) => {
  if (record.set_name === "gold" && !record.expected) {
    context.addIssue({ code: "custom", path: ["expected"], message: "Gold cases require an expected decision." });
  }
  if (record.set_name !== "gold" && record.expected) {
    context.addIssue({ code: "custom", path: ["expected"], message: "Expected decisions are reserved for gold cases." });
  }
});
export type CaseRecord = z.infer<typeof CaseRecord>;
