import type { ChangedField } from "./change-detection.ts";
import { displayPrice, type ListingField, type Price } from "./normalize.ts";

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
