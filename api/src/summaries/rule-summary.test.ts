import assert from "node:assert/strict";
import { test } from "node:test";
import { ruleSummary } from "./rule-summary.ts";

const price = (before: string, after: string) => ({ field: "price" as const, before, after });

test("price drops and rises say which way and by how much", () => {
  assert.equal(ruleSummary([price("$39/mo", "$29/mo")]), "Price dropped from $39/mo to $29/mo (-26%).");
  assert.equal(ruleSummary([price("$29/mo", "$39/mo")]), "Price rose from $29/mo to $39/mo (+34%).");
});

test("free ↔ paid", () => {
  assert.equal(ruleSummary([price("$39/mo", "Free")]), "Now free (was $39/mo).");
  assert.equal(ruleSummary([price("Free", "$10/mo")]), "No longer free: now $10/mo.");
});

test("prices that can't be compared are just stated", () => {
  assert.equal(ruleSummary([price("$39/mo", "$390/yr")]), "Price changed from $39/mo to $390/yr.");
  assert.equal(ruleSummary([price("$39/mo", "€35/mo")]), "Price changed from $39/mo to €35/mo.");
  assert.equal(ruleSummary([price("$39/mo", "Contact sales")]), "Price changed from $39/mo to Contact sales.");
});

test("title and availability changes", () => {
  assert.equal(ruleSummary([{ field: "title", before: "Acme CRM", after: "Acme CRM Pro" }]), 'Renamed from "Acme CRM" to "Acme CRM Pro".');
  assert.equal(
    ruleSummary([{ field: "availability", before: "listed", after: "not listed" }]),
    "Removed from the source: the listing is no longer available.",
  );
});

test("several structured changes become one summary, in order", () => {
  assert.equal(
    ruleSummary([{ field: "availability", before: "not listed", after: "listed" }, price("$39/mo", "$29/mo")]),
    "Back on the source after being unavailable. Price dropped from $39/mo to $29/mo (-26%).",
  );
});

test("any wording change is left to the LLM", () => {
  assert.equal(ruleSummary([{ field: "tagline", before: "a", after: "b" }]), null);
  assert.equal(ruleSummary([price("$39/mo", "$29/mo"), { field: "description", before: "a", after: "b" }]), null);
  assert.equal(ruleSummary([]), null);
});
