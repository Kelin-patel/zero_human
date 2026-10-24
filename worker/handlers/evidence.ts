import { CaseCard } from "../../src/lib/case-schema";
import { getSql } from "../../src/lib/db";
import { exaTerms, httpCheck, solariCheck, type AccessCheck } from "../../src/lib/evidence";
import type { JobRow } from "../../src/lib/repo";

// Only the fictional demo store publishes terms we control; other merchants have no terms URL yet.
function termsUrl(merchantId: string | null): string | null {
  if (merchantId !== "demo") return null;
  const base = process.env.APP_BASE_URL;
  if (!base) throw new Error("APP_BASE_URL is not set");
  return `${base.replace(/\/+$/u, "")}/demo/terms`;
}

/**
 * Builds the case file for an appealed case: a Solari access check of the course page and an Exa
 * excerpt of the store's terms. Each kind is stored once, so a retried job only redoes what failed.
 */
export async function gatherEvidence(caseId: string): Promise<{ stored: string[]; skipped: string[] }> {
  const sql = getSql();
  const [row] = await sql`SELECT id, merchant_id, facts FROM cases WHERE id = ${caseId}`;
  if (!row) throw new Error(`Unknown case ${caseId}.`);
  const card = CaseCard.parse(row.facts);
  const [decision] = await sql`SELECT clauses FROM decisions WHERE case_id = ${caseId} AND agent_version = 'live'`;
  const have = new Set((await sql`SELECT kind FROM evidence WHERE case_id = ${caseId}`).map((e) => String(e.kind)));
  const stored: string[] = [];
  const skipped: string[] = [];

  async function store(kind: string, summary: string, url: string, httpStatus: number | null, raw: Record<string, unknown>, shot: AccessCheck["screenshot"]) {
    const rows = await sql`
      INSERT INTO evidence (id, case_id, kind, summary, url, http_status, screenshot_url, raw)
      SELECT n, ${caseId}, ${kind}, ${summary}, ${url}, ${httpStatus},
             CASE WHEN ${shot !== null}::boolean THEN '/api/evidence/' || n || '/screenshot' END,
             ${JSON.stringify({ ...raw, screenshot: shot })}::jsonb
      FROM (SELECT nextval(pg_get_serial_sequence('evidence', 'id')) AS n) s
      WHERE NOT EXISTS (SELECT 1 FROM evidence WHERE case_id = ${caseId} AND kind = ${kind})
      RETURNING id`;
    (rows.length ? stored : skipped).push(kind);
  }

  const tasks: Promise<void>[] = [];
  if (!have.has("solari_check") && !have.has("http_check")) {
    tasks.push((async () => {
      const target = card.records.access_check.url;
      let check: AccessCheck;
      try {
        check = await solariCheck(target);
      } catch (error) {
        console.warn(`[evidence] ${caseId} Solari unavailable (${error instanceof Error ? error.message : "unknown"}); using a direct request`);
        check = await httpCheck(target);
      }
      const kind = check.method === "solari" ? "solari_check" : "http_check";
      const how = check.method === "solari" ? "Opened in a remote browser" : "Requested directly (remote browser unavailable)";
      const summary = `${how}: HTTP ${check.httpStatus ?? "no response"}${check.title ? `, page title "${check.title}"` : ""}.${check.note ? ` ${check.note}` : ""}`;
      await store(kind, summary, check.url, check.httpStatus, { method: check.method, title: check.title, checkedAt: new Date().toISOString() }, check.screenshot);
    })());
  } else skipped.push("access_check");

  const terms = termsUrl(row.merchant_id);
  if (terms && !have.has("exa_terms")) {
    tasks.push((async () => {
      const result = await exaTerms(terms, decision?.clauses ?? []);
      await store("exa_terms", result.excerpt, result.url, null, { title: result.title, clauses: result.clauses, source: "exa_contents" }, null);
    })());
  } else skipped.push("exa_terms");

  const outcomes = await Promise.allSettled(tasks);
  const failures = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
  if (failures.length) {
    throw new Error(`Evidence incomplete for ${caseId}: ${failures.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join("; ")}`);
  }
  return { stored, skipped };
}

export async function evidence(job: JobRow): Promise<void> {
  if (!job.case_id) throw new Error("Evidence job has no case.");
  const result = await gatherEvidence(job.case_id);
  console.log(`[evidence] ${job.case_id}: stored ${result.stored.join(", ") || "nothing new"}`);
}
