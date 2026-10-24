import { readFileSync } from "node:fs";
import { STOP_AT } from "./terac-data";

export const FOLLOWUP_STOP_AT = "2026-10-24T18:10:00-04:00";
export const FOLLOWUP_VERSION = "v2_followup";
export const FOLLOWUP_DRY_RUN_FILE = ".baseline-runs/v2-followup-notes.dry-run.json";

export function assertFollowupNote(protocol = readFileSync("data/PREREGISTRATION.md", "utf8")): void {
  if (!protocol.includes("## Follow-up collection") || !protocol.includes("18:10 America/New_York") || !protocol.includes("exploratory follow-up")) {
    throw new Error("Publish the timestamped follow-up collection note before continuing recruitment.");
  }
}

export function collectionStopAt(meta: Record<string, unknown> | null | undefined): string {
  const followup = meta?.followup as { startedAt?: string; stopAt?: string } | undefined;
  if (!followup) return STOP_AT;
  if (followup.stopAt !== FOLLOWUP_STOP_AT || !followup.startedAt || !Number.isFinite(Date.parse(followup.startedAt)) || Date.parse(followup.startedAt) < Date.parse(STOP_AT) || Date.parse(followup.startedAt) >= Date.parse(FOLLOWUP_STOP_AT)) {
    throw new Error("The stored follow-up window is invalid.");
  }
  return FOLLOWUP_STOP_AT;
}

export function followupStart(meta: Record<string, unknown> | null | undefined): string {
  assertFollowupNote();
  if (collectionStopAt(meta) !== FOLLOWUP_STOP_AT) throw new Error("Follow-up recruitment has not been confirmed as resumed.");
  return (meta!.followup as { startedAt: string }).startedAt;
}

export function isScheduledPause(action: unknown, collection: unknown, followup: boolean): boolean {
  // An old cutoff job must not stop the explicitly continued collection window.
  return action === "pause" && (!followup || collection === "followup");
}
