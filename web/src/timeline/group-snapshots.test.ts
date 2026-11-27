import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot, SummaryStatus } from "../api.ts";
import { groupSnapshots, quietRunSpan, timelineItemKey } from "./group-snapshots.ts";

let nextId = 100;
const snapshot = (summaryStatus: SummaryStatus): Snapshot => ({
  id: nextId--,
  fetchedAt: new Date(Date.UTC(2026, 10, 26, 12, nextId)).toISOString(),
  lastCheckedAt: new Date(Date.UTC(2026, 10, 26, 12, nextId)).toISOString(),
  checkCount: 1,
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
  summarySource: null,
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

test("a run counts every check its rows stand for, from the oldest first check to the newest last check", () => {
  const stored = { ...snapshot("not_changed"), checkCount: 5, lastCheckedAt: "2026-11-26T15:00:00.000Z" };
  const older = { ...snapshot("not_changed"), fetchedAt: "2026-11-26T09:00:00.000Z" };
  const [run] = groupSnapshots([stored, older]);
  assert.ok(run?.kind === "quiet_run");
  assert.deepEqual(quietRunSpan(run.snapshots), {
    checks: 6,
    from: "2026-11-26T09:00:00.000Z",
    to: "2026-11-26T15:00:00.000Z",
  });
});
