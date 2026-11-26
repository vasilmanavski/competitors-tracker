import { CompetitorNotTrackedError } from "../competitors/errors.ts";
import type { DataAccess } from "../data-access.ts";
import { type ChangeDecision, type Comparable, comparable, detectChange, type PollOutcome } from "../listings/change-detection.ts";
import { describeChanges, type DisplayListing, type FieldChange, toDisplayListing } from "../listings/field-changes.ts";
import { priceOf, type Snapshot, type TimelinePage } from "./repository.ts";

/** A stored poll and the change decision made for it. */
export type RecordedPoll = { snapshot: Snapshot; decision: ChangeDecision };

function toComparable(snapshot: Snapshot): Comparable {
  return comparable({ ...snapshot, price: priceOf(snapshot) });
}

function displayListingOf(outcome: PollOutcome): DisplayListing | null {
  return outcome.status === "ok" || outcome.status === "partial" ? toDisplayListing(outcome.listing) : null;
}

function changesFor(decision: ChangeDecision, lastOk: Snapshot | null, outcome: PollOutcome): FieldChange[] {
  if (!decision.changed) return [];
  const before = lastOk && toDisplayListing({ ...lastOk, price: priceOf(lastOk) });
  return describeChanges(decision.changedFields, before, displayListingOf(outcome));
}

/** Use cases for a competitor's snapshot history. */
export function createSnapshotService(data: DataAccess) {
  return {
    /**
     * One page of a competitor's timeline, newest first.
     * @throws CompetitorNotTrackedError so the UI can tell "removed" from "no polls yet"
     */
    async listTimeline(competitorId: string, page: TimelinePage): Promise<Snapshot[]> {
      const { competitorRepository, snapshotRepository } = data.repositories;
      if (!(await competitorRepository.existsById(competitorId))) throw new CompetitorNotTrackedError(competitorId);
      return snapshotRepository.findNewestFirst(competitorId, page);
    },

    /**
     * Stores one poll result and decides whether it is a change that matters. A change is
     * stored with its old → new values and queued for a summary; the LLM never runs here.
     * Runs in one transaction with the competitor row locked, so concurrent polls of
     * the same competitor can't compare against the same baseline.
     * @returns null when the competitor was removed while it was being fetched
     */
    recordPoll(competitorId: string, outcome: PollOutcome, fetchedAt: Date): Promise<RecordedPoll | null> {
      return data.transaction(async ({ competitorRepository, snapshotRepository }) => {
        const competitor = await competitorRepository.lockForUpdate(competitorId);
        if (!competitor) return null;

        const lastOk = await snapshotRepository.findLatestOk(competitorId);
        const decision = detectChange(outcome, lastOk && toComparable(lastOk), competitor.listingState);

        const snapshot = await snapshotRepository.insert({
          competitorId,
          fetchedAt,
          outcome,
          decision,
          changes: changesFor(decision, lastOk, outcome),
          summaryDueAt: decision.changed ? fetchedAt : null,
        });
        await competitorRepository.updatePollResult(competitorId, {
          polledAt: fetchedAt,
          status: outcome.status,
          listingState: decision.nextListingState,
          changed: decision.changed,
        });
        return { snapshot, decision };
      });
    },
  };
}

export type SnapshotService = ReturnType<typeof createSnapshotService>;
