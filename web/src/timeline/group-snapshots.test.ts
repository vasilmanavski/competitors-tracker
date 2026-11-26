import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot, SummaryStatus } from "../api.ts";
import { groupSnapshots, timelineItemKey } from "./group-snapshots.ts";

let nextId = 100;
const snapshot = (summaryStatus: SummaryStatus): Snapshot => ({
  id: nextId--,
  fetchedAt: new Date(Date.UTC(2026, 10, 26, 12, nextId)).toISOString(),
  status: summaryStatus === "not_found" ? "not_found" : "ok",
  title: "Acme CRM",
  tagline: null,
  price: null,
  priceRaw: null,
  description: null,
  changed: summaryStatus === "pending",
  changedFields: [],
  missingFields: [],
  summary: null,
  summaryStatus,
  summaryError: null,
  summaryAttempts: 0,
  summaryRetryAt: null,
  changes: [],
  error: null,
});

const shape = (statuses: SummaryStatus[]) =>
  groupSnapshots(statuses.map(snapshot)).map((item) =>
    item.kind === "event" ? item.snapshot.summaryStatus : `${item.runKind}×${item.snapshots.length}`,
  );

test("consecutive unchanged polls collapse into one run; events stay separate", () => {
  assert.deepEqual(
    shape(["not_changed", "not_changed", "pending", "not_changed", "fetch_failed", "not_changed", "first_snapshot"]),
    ["unchanged×2", "pending", "unchanged×1", "fetch_failed", "unchanged×1", "first_snapshot"],
  );
});

test("repeated 404s collapse separately from unchanged polls", () => {
  assert.deepEqual(shape(["not_found", "not_found", "not_changed", "not_changed"]), [
    "still_not_listed×2",
    "unchanged×2",
  ]);
});

test("partial listings and changes are never collapsed", () => {
  assert.deepEqual(shape(["incomplete_listing", "incomplete_listing", "pending", "pending"]), [
    "incomplete_listing",
    "incomplete_listing",
    "pending",
    "pending",
  ]);
});

test("a run keeps its key when a newer poll joins it", () => {
  const older = [snapshot("not_changed"), snapshot("not_changed")];
  const [before] = groupSnapshots(older);
  const newer = { ...snapshot("not_changed"), id: 1_000 };
  const [after] = groupSnapshots([newer, ...older]);
  assert.ok(before && after);
  assert.equal(timelineItemKey(after), timelineItemKey(before));
});
