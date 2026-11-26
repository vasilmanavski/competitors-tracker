// Decides, for one new poll result, whether it is a change that matters.
// Pure function: the caller loads the inputs inside the same transaction that
// stores the snapshot, so two polls can't both compare against the same baseline.

import type { ListingState, SummaryStatus } from "../db/schema.ts";
import { type ListingField, type NormalizedListing, priceKey, type Price } from "./normalize.ts";

// The comparable form of a listing: the 4 fields after normalisation.
export type Comparable = Record<ListingField, string | null>;

// "availability" marks a delisting (ok → 404) or relisting (404 → ok), decision 2.2.
export type ChangedField = ListingField | "availability";

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

export function comparable(fields: {
  title: string | null;
  tagline: string | null;
  description: string | null;
  priceText: string | null;
  price: Price | null;
}): Comparable {
  return {
    title: fields.title,
    tagline: fields.tagline,
    price: priceKey(fields.price, fields.priceText),
    description: fields.description,
  };
}

function diff(before: Comparable, after: Comparable): ListingField[] {
  return (["title", "tagline", "price", "description"] as const).filter((f) => before[f] !== after[f]);
}

const noChange = (): Pick<ChangeDecision, "changed" | "changedFields"> => ({ changed: false, changedFields: [] });

/**
 * @param outcome   what this poll produced
 * @param lastOk    the latest `ok` snapshot (decision 2.5: the only comparison baseline)
 * @param state     the competitor's listing state before this poll
 */
export function detectChange(
  outcome: PollOutcome,
  lastOk: Comparable | null,
  state: ListingState,
): ChangeDecision {
  switch (outcome.status) {
    // Decision 2.2: failures never count as delisting; they leave the state alone.
    case "fetch_failed":
      return { ...noChange(), summaryStatus: "fetch_failed", nextListingState: state };

    // Decision 2.6: a partial listing is never a baseline and never "field removed".
    case "partial":
      return { ...noChange(), summaryStatus: "incomplete_listing", nextListingState: state };

    // Decision 2.14 (proposed): a 404 is a change only if we had seen the listing.
    // Before that it's "never found at source" (typo or not yet listed).
    case "not_found":
      if (state === "listed") {
        return { changed: true, changedFields: ["availability"], summaryStatus: "pending", nextListingState: "delisted" };
      }
      return {
        ...noChange(),
        summaryStatus: "not_found",
        nextListingState: state === "delisted" ? "delisted" : "never_listed",
      };

    case "ok": {
      const current = comparable(outcome.listing);
      if (lastOk === null) {
        return { ...noChange(), summaryStatus: "first_snapshot", nextListingState: "listed" };
      }
      // Decision 2.13 (proposed): after normalisation, any text difference is a
      // real edit by the competitor, so it counts.
      const fields: ChangedField[] = diff(lastOk, current);
      if (state === "delisted") fields.unshift("availability");
      return fields.length > 0
        ? { changed: true, changedFields: fields, summaryStatus: "pending", nextListingState: "listed" }
        : { ...noChange(), summaryStatus: "not_changed", nextListingState: "listed" };
    }
  }
}
