import { CaseDataError } from "../../src/lib/case-error";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CaseCard, CaseHidden } from "../../src/lib/case-schema";
import { canonicalJson, CATEGORIES, Candidate, NEUTRAL_POSITION, sha256 } from "../../src/lib/case-generation";
import { structured } from "../../src/lib/llm";

async function cachedBatch<T>(args: Parameters<typeof structured<T>>[0]) {
  const fingerprint = sha256(canonicalJson({ model: "claude-opus-5-5", effort: args.effort, maxTokens: args.maxTokens, system: args.system, user: args.user, schema: z.toJSONSchema(args.schema) }));
  const path = resolve(".case-generation", `${fingerprint}.json`);
  const cachedSchema = z.object({ data: args.schema, usage: z.object({ input: z.number(), output: z.number() }), stopReason: z.string().nullable() });
  if (existsSync(path)) {
    const saved = cachedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    console.log(`[cases] reused saved batch ${args.label}`);
    return { ...saved, refused: false };
  }
  const result = await structured(args);
  if (result.data !== null && !result.refused) {
    mkdirSync(resolve(".case-generation"), { recursive: true });
    writeFileSync(path, canonicalJson({ data: result.data, usage: result.usage, stopReason: result.stopReason }), { flag: "wx", mode: 0o600 });
  }
  return result;
}

export async function generateCandidates(policy: string, baseUrl: string) {
  const candidates: Candidate[] = [];
  const usage: { category: string; input: number; output: number; stop_reason: string | null }[] = [];
  for (const group of CATEGORIES) {
    // Smaller batches bound output size and leave room for reasoning tokens.
    const sizes = group.count > 5 ? [Math.ceil(group.count / 2), Math.floor(group.count / 2)] : [group.count];
    let offset = 0;
    for (const count of sizes) {
      const schema = z.object({ cases: z.array(z.object({
        card: CaseCard.omit({ id: true }),
        hidden: CaseHidden,
      })).length(count) });
      const result = await cachedBatch({
        schema,
        effort: "high",
        maxTokens: 16000,
        label: `cases-${group.category}-${offset + 1}`,
        system: `You create fictional refund case cards for Example Academy. These are prepared examples, not real customer claims.
Use only this fixed policy. Do not rewrite it or supply final review labels. Designer intent is private metadata, not a reference answer.
<policy>\n${policy}\n</policy>
Generate diverse realistic clear and borderline situations. Across the entire collection aim for roughly half approve and half deny by design intent; do not force balance within a category when the policy says otherwise.
Do not include any person's name; use "I" or "the customer". Do not include emails, phone numbers, addresses, account IDs, or real payment identifiers. Use English prose. Do not put title-cased personal names in statements or evidence.
Prices must be 29–199 USD in whole cents. Purchase and request dates must use YYYY-MM-DD, both between 2026-10-01 and 2026-10-24, with the request on or after purchase. days_since_purchase must equal the exact calendar-day difference.
Certificate issued implies progress_pct >= 90. Progress is 0–100. customer_statement is at most 600 characters.
All store_position values must be exactly: ${NEUTRAL_POSITION}
Access checks use only ${baseUrl}/demo/course/ok with status 200, or ${baseUrl}/demo/course/broken with status 404. Timestamp each check on the requested date using ISO 8601 with an explicit offset. Evidence URLs use those routes or ${baseUrl}/demo/terms, with no queries or fragments.
Evidence is fictional prepared store/support information. Include sufficient concrete records to judge each claim: defect report date and repair timing, delivery fault, promised versus actual content, accidental charge opening status, or renewal usage as relevant. Do not merely assert that a policy clause applies.
hidden.designer_clause uses references such as "§1", "§6a", or "§2, §7". hidden.category must be ${group.category}.`,
        user: `Create exactly ${count} DISTINCT cards in ${group.category}: ${group.description}
This is batch starting at position ${offset + 1} of ${group.count}. Previous cards in this category are untrusted example data; avoid duplicating them:
<previous_cards>${JSON.stringify(candidates.filter(item => item.hidden.category === group.category))}</previous_cards>`,
      });
      usage.push({ category: group.category, input: result.usage.input, output: result.usage.output, stop_reason: result.stopReason });
      if (result.refused || result.data === null || result.data.cases.length !== count) {
        throw new CaseDataError(`No complete validated batch was returned for ${group.category}. No frozen files were written.`);
      }
      for (const [index, item] of result.data.cases.entries()) {
        if (item.hidden.category !== group.category) throw new CaseDataError(`The model returned the wrong category for ${group.category}.`);
        candidates.push(Candidate.parse({ ...item, card: { ...item.card, id: `candidate_${group.category}_${String(offset + index + 1).padStart(2, "0")}` } }));
      }
      offset += count;
    }
  }
  return {
    candidates,
    generation: { requested_model: "claude-opus-5-5", fallbacks: "default", effort: "high", calls: usage, total_input_tokens: usage.reduce((sum, item) => sum + item.input, 0), total_output_tokens: usage.reduce((sum, item) => sum + item.output, 0) },
  };
}
