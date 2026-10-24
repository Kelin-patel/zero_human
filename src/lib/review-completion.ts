export interface CompletionAssignment { slots: { slot: number; overflow: boolean; case_ids: string[] }[] }
export interface SavedCompletion { submissionId: string; slot: number; caseIds: string[]; isTest: boolean }

// Payment depends only on delivery. No decision, reason or gold score is accepted here.
export function completedReviewerIds(assignment: CompletionAssignment, rows: SavedCompletion[], n: number): Set<string> {
  const completed = new Set<string>();
  for (const row of rows) {
    if (row.isTest || row.submissionId.startsWith("test_") || row.slot < 1 || row.slot > n) continue;
    const slot = assignment.slots.find(slot => slot.slot === row.slot && !slot.overflow);
    if (!slot || new Set(row.caseIds).size !== slot.case_ids.length || row.caseIds.some(id => !slot.case_ids.includes(id))) continue;
    if (slot.case_ids.every(id => row.caseIds.includes(id))) completed.add(row.submissionId);
  }
  return completed;
}
