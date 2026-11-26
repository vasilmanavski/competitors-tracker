import { formatPrice } from "../listings/normalize.ts";
import { priceOf, type Snapshot } from "./repository.ts";

/**
 * Maps a snapshot to the timeline JSON shape. `price` is the canonical display form
 * when the price was understood ("$39/mo"), otherwise the source's cleaned wording.
 */
export function toSnapshotDto(snapshot: Snapshot) {
  const price = priceOf(snapshot);
  return {
    id: snapshot.id,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    status: snapshot.status,
    title: snapshot.title,
    tagline: snapshot.tagline,
    price: price ? formatPrice(price) : snapshot.priceText,
    priceDetail: price,
    priceRaw: snapshot.priceText,
    description: snapshot.description,
    changed: snapshot.changed,
    changedFields: snapshot.changedFields,
    missingFields: snapshot.missingFields,
    summary: snapshot.summary,
    summaryStatus: snapshot.summaryStatus,
    summaryError: snapshot.summaryError,
    summaryAttempts: snapshot.summaryAttempts,
    summaryRetryAt: snapshot.summaryNextAttemptAt?.toISOString() ?? null,
    changes: snapshot.changes,
    error: snapshot.error,
  };
}
