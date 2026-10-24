import { CaseDataError } from "./case-error";
import { getSql } from "./db";
import { loadPolicy } from "./policy";

export async function seedDemoMerchant(): Promise<{ merchantId: "demo"; policyId: number; policySha256: string }> {
  const policy = loadPolicy();
  const sql = getSql();
  const rows = await sql`
    with merchant as (
      insert into merchants (id, name, mode, max_refund_cents, max_daily_refund_cents)
      values ('demo', 'Example Academy (fictional)', 'demo', 10000, 30000)
      on conflict (id) do update set
        name = excluded.name,
        max_refund_cents = excluded.max_refund_cents,
        max_daily_refund_cents = excluded.max_daily_refund_cents
      where merchants.mode = 'demo' and merchants.whop_account_id is null
      returning id
    )
    insert into policies (merchant_id, version, text, sha256)
    select id, 1, ${policy.text}, ${policy.sha256} from merchant
    on conflict (merchant_id, version) do update set sha256 = policies.sha256
      where policies.sha256 = excluded.sha256 and policies.text = excluded.text
    returning id
  `;
  if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0].id))) {
    throw new CaseDataError("The demo merchant or frozen policy conflicts with existing database data; nothing may replace that policy.");
  }
  return { merchantId: "demo", policyId: Number(rows[0].id), policySha256: policy.sha256 };
}
