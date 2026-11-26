import type { PollOutcome } from "../listings/change-detection.ts";
import { normalizeListing } from "../listings/normalize.ts";
import type { SnapshotRepository } from "../snapshots/repository.ts";
import type { FetchResult, SourceClient } from "../source/source-client.ts";

// One poll = fetch → normalise → store (+ diff). Always produces exactly one
// snapshot, unless the competitor was removed mid-poll or we're shutting down.

export type PollLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

export function toOutcome(result: FetchResult): PollOutcome {
  switch (result.kind) {
    case "not_found":
      return { status: "not_found" };
    case "failed":
      return { status: "fetch_failed", error: result.error };
    case "ok": {
      const listing = normalizeListing(result.body);
      if (!listing) return { status: "fetch_failed", error: "response was not a JSON object" };
      return { status: listing.missing.length > 0 ? "partial" : "ok", listing };
    }
  }
}

export function createPoller(deps: { source: SourceClient; snapshots: SnapshotRepository; log: PollLogger }) {
  return async function poll(competitorId: string, signal?: AbortSignal): Promise<void> {
    const result = await deps.source.fetchListing(competitorId, signal);
    const outcome = toOutcome(result);
    const saved = await deps.snapshots.recordPoll(competitorId, outcome, new Date());
    if (!saved) {
      deps.log.info({ competitorId }, "poll dropped: competitor was removed while fetching");
      return;
    }
    const { snapshot, decision } = saved;
    const fields = { competitorId, status: snapshot.status, changed: decision.changed, changedFields: decision.changedFields };
    if (outcome.status === "fetch_failed") deps.log.warn({ ...fields, error: outcome.error }, "poll failed");
    else deps.log.info(fields, "poll stored");
  };
}

export type Poll = ReturnType<typeof createPoller>;
