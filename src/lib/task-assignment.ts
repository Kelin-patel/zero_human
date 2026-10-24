import { z } from "zod";
import type { CaseRecord } from "./case-schema";
import { CASE_SEED, mulberry32, shuffle } from "./case-generation";

export const Assignment = z.object({
  schema_version: z.literal(1), seed: z.literal(CASE_SEED),
  participants: z.union([z.literal(10), z.literal(11)]),
  cards_per_reviewer: z.union([z.literal(6), z.literal(8)]),
  cases_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  slots: z.array(z.object({ slot: z.number().int().positive(), overflow: z.boolean(), case_ids: z.array(z.string()).min(1) })),
});
export type Assignment = z.infer<typeof Assignment>;

export function makeAssignment(records: CaseRecord[], casesHash: string, participants: 10 | 11 = 11, cards: 6 | 8 = 8): Assignment {
  const random = mulberry32(CASE_SEED);
  const ids = (set: string) => shuffle(records.filter(r => r.set_name === set).map(r => r.card.id).sort(), random);
  const evaluation = ids("eval").slice(0, cards === 8 ? 27 : 20);
  const development = ids("dev").slice(0, cards === 8 ? 22 : 13);
  const gold = records.filter(r => r.set_name === "gold").map(r => r.card.id).sort();
  if (evaluation.length !== (cards === 8 ? 27 : 20) || development.length !== (cards === 8 ? 22 : 13) || gold.length !== 4) throw new Error("Incomplete frozen cases.");
  const rows: string[][] = Array.from({ length: 11 }, () => []);
  const realSeats = 11 * (cards - 1);
  const evalSeats = realSeats - development.length;
  const repeated = [...evaluation, ...evaluation, ...evaluation.slice(0, evalSeats - evaluation.length * 2)];
  repeated.forEach((id, index) => rows[index % 11].push(id));
  const remaining = rows.flatMap((row, index) => Array.from({ length: cards - 1 - row.length }, () => index));
  development.forEach((id, index) => rows[remaining[index]].push(id));
  const slots = rows.slice(0, participants).map((row, index) => ({ slot: index + 1, overflow: false, case_ids: shuffle([...row, gold[index % 4]], random) }));
  for (let slot = 12; slot <= 16; slot++) {
    slots.push({ slot, overflow: true, case_ids: shuffle(evaluation, random).slice(0, cards === 8 ? 5 : 3) });
  }
  return Assignment.parse({ schema_version: 1, seed: CASE_SEED, participants, cards_per_reviewer: cards, cases_sha256: casesHash, slots });
}

export function assertAssignment(assignment: Assignment, records: CaseRecord[]): void {
  const expected = makeAssignment(records, assignment.cases_sha256, assignment.participants, assignment.cards_per_reviewer);
  if (JSON.stringify(assignment) !== JSON.stringify(expected)) throw new Error("Assignment differs from its deterministic seed and design.");
  for (const row of assignment.slots) {
    if (new Set(row.case_ids).size !== row.case_ids.length) throw new Error("A reviewer cannot see the same card twice.");
  }
}
