import assert from "node:assert/strict";
import { test } from "node:test";
import { type DisplayListing, describeChanges, priceChangePercent, wordingEdit } from "./field-changes.ts";

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

test("price change percent: rounded, signed, only for comparable paid prices", () => {
  assert.equal(priceChangePercent("$29/mo", "$39/mo"), 34);
  assert.equal(priceChangePercent("$39/mo", "USD 29 per month"), -26);
  assert.equal(priceChangePercent("$39/mo", "Free"), null);
  assert.equal(priceChangePercent("$39/mo", "€39/mo"), null);
  assert.equal(priceChangePercent("$39/mo", "$390/yr"), null);
  assert.equal(priceChangePercent("$39/mo", "Contact sales"), null);
});

test("wording edit: an appended or removed sentence is found", () => {
  const base = "Track leads & deals in one place.";
  const longer = `${base} Now with AI follow-up reminders.`;
  assert.deepEqual(wordingEdit(base, longer), { kind: "added", text: "Now with AI follow-up reminders." });
  assert.deepEqual(wordingEdit(longer, base), { kind: "removed", text: "Now with AI follow-up reminders." });
});

test("wording edit: words inserted in the middle are found", () => {
  assert.deepEqual(wordingEdit("Payments for marketplaces", "Payments for marketplaces and platforms"), {
    kind: "added",
    text: "and platforms",
  });
  assert.deepEqual(
    wordingEdit("Onboarding, time off, reviews in one place.", "Onboarding, time off, reviews and payroll exports in one place."),
    { kind: "added", text: "and payroll exports" },
  );
});

test("wording edit: none for a rewrite, a same-length edit, or too little shared text", () => {
  assert.equal(
    wordingEdit(
      "Event tracking, funnels and retention cohorts. Self-serve, no sales calls.",
      "Event tracking, funnels, retention cohorts and session replay. Self-serve, no sales calls.",
    ),
    null,
  );
  assert.equal(wordingEdit("Send invoices and get paid faster.", "Send invoices and get payed faster."), null);
  assert.equal(wordingEdit("Simple CRM", "Simple CRM for teams"), null);
});
