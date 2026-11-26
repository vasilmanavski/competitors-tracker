import type { ListingState, SummaryStatus } from "../db/schema.ts";
import { LISTING_FIELDS, type ListingField, type NormalizedListing, type Price, priceKey } from "./normalize.ts";

/** A listing reduced to the values that are compared between polls. */
export type Comparable = Record<ListingField, string | null>;

/** A changed listing field, or `availability` for a delisting (ok → 404) or relisting (404 → ok). */
export type ChangedField = ListingField | "availability";

/** What one poll produced, after normalisation. */
export type PollOutcome =
  | { status: "ok" | "partial"; listing: NormalizedListing }
  | { status: "not_found" }
  | { status: "fetch_failed"; error: string };

export type ChangeDecision = {
  changed: boolean;
  changedFields: ChangedField[];
  summaryStatus: SummaryStatus;
  nextListingState: ListingState;
};

type ComparableSource = {
  title: string | null;
  tagline: string | null;
  description: string | null;
  priceText: string | null;
  price: Price | null;
};

/** Builds the comparable form of a listing or stored snapshot. */
export function comparable(fields: ComparableSource): Comparable {
  return {
    title: fields.title,
    tagline: fields.tagline,
    price: priceKey(fields.price, fields.priceText),
    description: fields.description,
  };
}

function changedFieldsBetween(before: Comparable, after: Comparable): ListingField[] {
  return LISTING_FIELDS.filter((field) => before[field] !== after[field]);
}

function unchanged(summaryStatus: SummaryStatus, nextListingState: ListingState): ChangeDecision {
  return { changed: false, changedFields: [], summaryStatus, nextListingState };
}

function changed(changedFields: ChangedField[], nextListingState: ListingState): ChangeDecision {
  return { changed: true, changedFields, summaryStatus: "pending", nextListingState };
}

function decideNotFound(state: ListingState): ChangeDecision {
  if (state === "listed") return changed(["availability"], "delisted");
  return unchanged("not_found", state === "delisted" ? "delisted" : "never_listed");
}

function decideOk(listing: NormalizedListing, lastOk: Comparable | null, state: ListingState): ChangeDecision {
  if (lastOk === null) return unchanged("first_snapshot", "listed");
  const fields: ChangedField[] = changedFieldsBetween(lastOk, comparable(listing));
  if (state === "delisted") fields.unshift("availability");
  return fields.length > 0 ? changed(fields, "listed") : unchanged("not_changed", "listed");
}

/**
 * Decides whether a poll is a change that matters. Failed and partial polls never
 * count as changes and never move the listing state; a 404 is a change only after
 * the listing had been seen.
 * @param outcome what this poll produced
 * @param lastOk  the latest complete (`ok`) listing, the only comparison baseline
 * @param state   the competitor's listing state before this poll
 */
export function detectChange(outcome: PollOutcome, lastOk: Comparable | null, state: ListingState): ChangeDecision {
  switch (outcome.status) {
    case "fetch_failed":
      return unchanged("fetch_failed", state);
    case "partial":
      return unchanged("incomplete_listing", state);
    case "not_found":
      return decideNotFound(state);
    case "ok":
      return decideOk(outcome.listing, lastOk, state);
  }
}
