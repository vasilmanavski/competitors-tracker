import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { comparable, detectChange, type PollOutcome } from "./change-detection.ts";
import { normalizeListing } from "./normalize.ts";

const listing = (patch: Record<string, unknown> = {}) =>
  normalizeListing({
    title: "Acme CRM",
    tagline: "Simple CRM for small teams",
    price: "$39/mo",
    description: "Track leads & deals in one place.",
    ...patch,
  })!;

const ok = (patch?: Record<string, unknown>): PollOutcome => ({ status: "ok", listing: listing(patch) });
const baseline = comparable(listing());

describe("detectChange", () => {
  test("first ok snapshot: nothing to compare", () => {
    assert.deepEqual(detectChange(ok(), null, "unknown"), {
      changed: false,
      changedFields: [],
      summaryStatus: "first_snapshot",
      nextListingState: "listed",
    });
  });

  test("same content in a different format: not changed", () => {
    const d = detectChange(ok({ price: "USD 39.00 per month", title: " Acme  CRM\n" }), baseline, "listed");
    assert.equal(d.changed, false);
    assert.equal(d.summaryStatus, "not_changed");
  });

  test("Free and $0/mo are the same price", () => {
    const free = comparable(listing({ price: "Free" }));
    assert.equal(detectChange(ok({ price: "$0/mo" }), free, "listed").changed, false);
  });

  test("real change: lists the changed fields", () => {
    const d = detectChange(ok({ price: "$29/mo", tagline: "The CRM small teams love" }), baseline, "listed");
    assert.deepEqual(d.changedFields, ["tagline", "price"]);
    assert.equal(d.changed, true);
    assert.equal(d.summaryStatus, "pending");
  });

  test("a small text edit counts (decision 2.13)", () => {
    const d = detectChange(ok({ description: "Track leads & deals in one place!" }), baseline, "listed");
    assert.deepEqual(d.changedFields, ["description"]);
  });

  test("partial listing: never a change, state untouched", () => {
    const d = detectChange({ status: "partial", listing: listing({ price: null }) }, baseline, "listed");
    assert.deepEqual(d, {
      changed: false,
      changedFields: [],
      summaryStatus: "incomplete_listing",
      nextListingState: "listed",
    });
  });

  test("fetch failure: never a change, never a delisting", () => {
    const d = detectChange({ status: "fetch_failed", error: "HTTP 503" }, baseline, "listed");
    assert.equal(d.changed, false);
    assert.equal(d.summaryStatus, "fetch_failed");
    assert.equal(d.nextListingState, "listed");
  });

  test("404 after being listed: delisting is a change", () => {
    assert.deepEqual(detectChange({ status: "not_found" }, baseline, "listed"), {
      changed: true,
      changedFields: ["availability"],
      summaryStatus: "pending",
      nextListingState: "delisted",
    });
  });

  test("404 again while delisted: not a new change", () => {
    const d = detectChange({ status: "not_found" }, baseline, "delisted");
    assert.equal(d.changed, false);
    assert.equal(d.nextListingState, "delisted");
  });

  test("404 for an id never seen: never_listed, not a change (decision 2.14)", () => {
    for (const state of ["unknown", "never_listed"] as const) {
      const d = detectChange({ status: "not_found" }, null, state);
      assert.equal(d.changed, false);
      assert.equal(d.summaryStatus, "not_found");
      assert.equal(d.nextListingState, "never_listed");
    }
  });

  test("first ok after never_listed: first snapshot, not a change", () => {
    assert.equal(detectChange(ok(), null, "never_listed").summaryStatus, "first_snapshot");
  });

  test("relisting is a change, and field edits since the last ok are included", () => {
    assert.deepEqual(detectChange(ok(), baseline, "delisted").changedFields, ["availability"]);
    assert.deepEqual(detectChange(ok({ price: "$29/mo" }), baseline, "delisted").changedFields, [
      "availability",
      "price",
    ]);
  });
});
