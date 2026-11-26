import assert from "node:assert/strict";
import { test } from "node:test";
import { type DisplayListing, describeChanges } from "./field-changes.ts";

const v1: DisplayListing = {
  title: "Acme CRM",
  tagline: "Simple CRM for small teams",
  price: "$39/mo",
  description: "Track leads & deals in one place.",
};
const v2: DisplayListing = { ...v1, tagline: "The CRM small teams love", price: "$29/mo" };

test("field changes carry the old and new display values", () => {
  assert.deepEqual(describeChanges(["tagline", "price"], v1, v2), [
    { field: "tagline", before: "Simple CRM for small teams", after: "The CRM small teams love" },
    { field: "price", before: "$39/mo", after: "$29/mo" },
  ]);
});

test("a delisting is listed → not listed", () => {
  assert.deepEqual(describeChanges(["availability"], v1, null), [
    { field: "availability", before: "listed", after: "not listed" },
  ]);
});

test("a relisting is not listed → listed, plus edits since the last complete listing", () => {
  assert.deepEqual(describeChanges(["availability", "price"], v1, v2), [
    { field: "availability", before: "not listed", after: "listed" },
    { field: "price", before: "$39/mo", after: "$29/mo" },
  ]);
});
