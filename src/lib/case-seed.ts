import { CaseRecord } from "./case-schema";
import { canonicalJson } from "./case-generation";
import { CaseDataError } from "./case-error";
import { readFrozenBundle } from "./case-files";
import { getSql } from "./db";
import { seedDemoMerchant } from "./demo-seed";
import { createCase } from "./repo";

export async function assertCollectionNotStarted(): Promise<void> {
  const sql = getSql();
  // Count collection activity without loading any human decisions or reasons.
  const [row] = await sql`select count(*)::int as count from reviews where not is_test and case_id ~ '^case_(dev|eval|gold)_'`;
  if (Number(row.count) > 0) throw new CaseDataError("Human collection has started; new case generation is disabled.");
}

export async function seedFrozenCases() {
  const { records, manifest } = readFrozenBundle();
  const demo = await seedDemoMerchant();
  const sql = getSql();
  const ids = records.map(record => record.card.id);
  const readRows = () => sql`select id, merchant_id, policy_id, set_name, facts, hidden, expected, whop_payment_id
    from cases where id = any(${ids}::text[])`;
  const existing = await readRows();
  const lookup = new Map(records.map(record => [record.card.id, record]));
  for (const row of existing) {
    const stored = CaseRecord.parse({ card: row.facts, set_name: row.set_name, hidden: row.hidden ?? undefined, expected: row.expected ?? undefined });
    if (row.merchant_id !== "demo" || Number(row.policy_id) !== demo.policyId || row.whop_payment_id !== null || canonicalJson(stored) !== canonicalJson(lookup.get(String(row.id)))) {
      throw new CaseDataError("An existing case differs from the frozen bundle. Seeding stopped without overwriting cases.");
    }
  }
  const existingIds = new Set(existing.map(row => String(row.id)));
  if (existingIds.size < records.length) await assertCollectionNotStarted();
  for (const record of records) {
    if (!existingIds.has(record.card.id)) {
      await createCase(record, { merchantId: demo.merchantId, policyId: demo.policyId });
    }
  }
  const stored = await readRows();
  if (stored.length !== 53) throw new CaseDataError("Database verification did not find all 53 frozen cases.");
  for (const row of stored) {
    const decoded = CaseRecord.parse({ card: row.facts, set_name: row.set_name, hidden: row.hidden ?? undefined, expected: row.expected ?? undefined });
    if (row.merchant_id !== "demo" || Number(row.policy_id) !== demo.policyId || row.whop_payment_id !== null || canonicalJson(decoded) !== canonicalJson(lookup.get(String(row.id)))) {
      throw new CaseDataError("A stored case did not round-trip exactly.");
    }
  }
  return { inserted: records.length - existingIds.size, verified: stored.length, dev: 22, eval: 27, gold: 4, policySha256: manifest.policy_sha256, casesSha256: manifest.sha256["cases.frozen.json"] };
}
