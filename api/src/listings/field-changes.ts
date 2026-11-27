import type { ChangedField } from "./change-detection.ts";
import { displayPrice, type ListingField, parsePrice, type Price } from "./normalize.ts";

/** A listing as people read it: every field as display text. */
export type DisplayListing = Record<ListingField, string | null>;

/** One changed field, old value → new value, as shown in the timeline and sent to the LLM. */
export type FieldChange = { field: ChangedField; before: string | null; after: string | null };

type ListingValues = {
  title: string | null;
  tagline: string | null;
  description: string | null;
  priceText: string | null;
  price: Price | null;
};

/** The display form of a normalised listing or a stored snapshot. */
export function toDisplayListing(values: ListingValues): DisplayListing {
  return {
    title: values.title,
    tagline: values.tagline,
    price: displayPrice(values.price, values.priceText),
    description: values.description,
  };
}

const LISTED = "listed";
const NOT_LISTED = "not listed";

function availabilityChange(afterIsListed: boolean): FieldChange {
  return afterIsListed
    ? { field: "availability", before: NOT_LISTED, after: LISTED }
    : { field: "availability", before: LISTED, after: NOT_LISTED };
}

/**
 * Turns the changed field names into old → new pairs.
 * @param changedFields
 * @param before the last complete listing (the comparison baseline), null when there is none
 * @param after  this poll's listing, null when the competitor is no longer listed
 */
export function describeChanges(
  changedFields: ChangedField[],
  before: DisplayListing | null,
  after: DisplayListing | null,
): FieldChange[] {
  return changedFields.map((field) =>
    field === "availability"
      ? availabilityChange(after !== null)
      : { field, before: before?.[field] ?? null, after: after?.[field] ?? null },
  );
}

/** "+34%" or "-26%" when both prices parse to the same currency and period and neither is free; else null. */
export function priceChangePercent(before: string, after: string): string | null {
  const [was, now] = [parsePrice(before), parsePrice(after)];
  if (!was || !now || was.amount === 0 || now.amount === 0) return null;
  if (was.currency !== now.currency || was.period !== now.period) return null;
  const percent = Math.round(((now.amount - was.amount) / was.amount) * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

/** Words appended, inserted or removed in a wording field while the rest stayed the same. */
export type WordingEdit = { kind: "added" | "removed"; text: string };

const MIN_SHARED_WORDS = 3;

function sharedPrefixLength(a: string[], b: string[]): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length++;
  return length;
}

/**
 * Finds the one stretch of words added or removed between two versions of a text, so a small
 * model is told exactly what is new. Returns null for a rewrite, where both sides differ.
 */
export function wordingEdit(before: string, after: string): WordingEdit | null {
  const [old, now] = [before.split(" "), after.split(" ")];
  if (old.length === now.length) return null;
  const prefix = sharedPrefixLength(old, now);
  const suffix = sharedPrefixLength(old.slice(prefix).reverse(), now.slice(prefix).reverse());
  const shared = prefix + suffix;
  if (shared < MIN_SHARED_WORDS || shared !== Math.min(old.length, now.length)) return null;
  const longer = now.length > old.length ? now : old;
  return { kind: longer === now ? "added" : "removed", text: longer.slice(prefix, longer.length - suffix).join(" ") };
}
