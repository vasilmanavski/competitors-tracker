import type { CompetitorRepository } from "../competitors/repository.ts";
import type { PollOutcome } from "../listings/change-detection.ts";
import { normalizeListing } from "../listings/normalize.ts";
import type { SnapshotService } from "../snapshots/service.ts";
import type { FetchResult, SourceClient } from "../source/source-client.ts";

export type PollLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

export type PollingServiceDeps = {
  source: SourceClient;
  snapshots: Pick<SnapshotService, "recordPoll">;
  competitors: Pick<CompetitorRepository, "claimDue">;
  intervalSeconds: number;
  log: PollLogger;
};

/** Turns a raw fetch result into what gets stored: normalised listing, 404, or failure. */
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

/** Use cases the scheduler drives: claim due competitors, then poll each one. */
export function createPollingService(deps: PollingServiceDeps) {
  const { source, snapshots, competitors, intervalSeconds, log } = deps;

  return {
    /** Claims up to `limit` competitors that are due, skipping the ids already being polled. */
    claimDue(limit: number, excludeIds: string[]): Promise<string[]> {
      return competitors.claimDue(limit, intervalSeconds, excludeIds);
    },

    /** Fetches, normalises and stores one competitor's listing. Every poll yields one snapshot. */
    async pollCompetitor(competitorId: string, signal?: AbortSignal): Promise<void> {
      const result = await source.fetchListing(competitorId, signal);
      const outcome = toOutcome(result);
      const recorded = await snapshots.recordPoll(competitorId, outcome, new Date());
      if (!recorded) {
        log.info({ competitorId }, "poll dropped: competitor was removed while fetching");
        return;
      }

      const { snapshot, decision } = recorded;
      const fields = { competitorId, status: snapshot.status, changed: decision.changed, changedFields: decision.changedFields };
      if (outcome.status === "fetch_failed") log.warn({ ...fields, error: outcome.error }, "poll failed");
      else log.info(fields, "poll stored");
    },
  };
}

export type PollingService = ReturnType<typeof createPollingService>;
