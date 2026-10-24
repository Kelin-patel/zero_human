import assert from "node:assert/strict";
import test from "node:test";
import { collectionStopAt, FOLLOWUP_STOP_AT, isScheduledPause, assertFollowupNote } from "./followup";
import { STOP_AT } from "./terac-data";

test("registered collection keeps its original cutoff and old pause job", () => {
  assert.equal(collectionStopAt({}), STOP_AT);
  assert.equal(isScheduledPause("pause", undefined, false), true);
});

test("only an explicit confirmed follow-up changes polling cutoff", () => {
  assert.equal(collectionStopAt({followup:{startedAt:"2026-10-24T21:45:00Z",stopAt:FOLLOWUP_STOP_AT}}), FOLLOWUP_STOP_AT);
  assert.throws(() => collectionStopAt({followup:{startedAt:"bad",stopAt:FOLLOWUP_STOP_AT}}));
  assert.throws(() => collectionStopAt({followup:{startedAt:FOLLOWUP_STOP_AT,stopAt:FOLLOWUP_STOP_AT}}));
  assert.throws(() => collectionStopAt({followup:{startedAt:"2026-10-24T21:45:00Z",stopAt:"2026-10-25T00:00:00Z"}}));
  assert.equal(isScheduledPause("pause", undefined, true), false);
  assert.equal(isScheduledPause("pause", "followup", true), true);
});

test("the follow-up requires a published explanatory note", () => {
  assert.throws(() => assertFollowupNote("original protocol only"));
  assert.doesNotThrow(() => assertFollowupNote("## Follow-up collection\n18:10 America/New_York\nexploratory follow-up"));
});
