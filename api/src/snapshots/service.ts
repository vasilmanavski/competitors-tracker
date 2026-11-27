import { CompetitorNotTrackedError } from "../competitors/errors.ts";
import type { DataAccess } from "../data-access.ts";
import type { SummaryStatus } from "../db/schema.ts";
import { type ChangeDecision, type Comparable, comparable, detectChange, type PollOutcome } from "../listings/change-detection.ts";
import { describeChanges, type DisplayListing, type FieldChange, toDisplayListing } from "../listings/field-changes.ts";
import { ruleSummary } from "../summaries/rule-summary.ts";
import { type InitialSummary, priceOf, type Snapshot, type TimelinePage } from "./repository.ts";

/** A stored poll and the change decision made for it. */
export type RecordedPoll = { snapshot: Snapshot; decision: ChangeDecision };

function toComparable(snapshot: Snapshot): Comparable {
  return comparable({ ...snapshot, price: priceOf(snapshot) });
}

function displayListingOf(outcome: PollOutcome): DisplayListing | null {
  return outcome.status === "ok" || outcome.status === "partial" ? toDisplayListing(outcome.listing) : null;
}

/** Structured changes get our own summary right away; wording changes are queued for the LLM. */
function initialSummaryFor(decision: ChangeDecision, changes: FieldChange[], fetchedAt: Date): InitialSummary {
  if (!decision.changed) return { status: decision.summaryStatus, text: null, source: null, dueAt: null };
  const text = ruleSummary(changes);
  if (text !== null) return { status: "summarized", text, source: "rule", dueAt: null };
  return { status: "pending", text: null, source: null, dueAt: fetchedAt };
}

const QUIET_RUN_STATUSES: ReadonlySet<SummaryStatus> = new Set(["not_changed", "not_found"]);

/** The newest snapshot when this poll is uneventful in the same way, so it only extends that run. */
function quietRunToExtend(decision: ChangeDecision, newest: Snapshot | null): Snapshot | null {
  if (!newest || !QUIET_RUN_STATUSES.has(decision.summaryStatus)) return null;
  return newest.summaryStatus === decision.summaryStatus ? newest : null;
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
     * stored with its old → new values; structured changes get a rule-written summary at once,
     * wording changes are queued for the LLM. The LLM never runs here. An unchanged or
     * still-not-listed poll that follows one of the same kind only extends that quiet run.
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

        const changes = changesFor(decision, lastOk, outcome);
        const run = quietRunToExtend(decision, await snapshotRepository.findNewest(competitorId));
        const snapshot = run
          ? await snapshotRepository.extendQuietRun(run.id, fetchedAt)
          : await snapshotRepository.insert({
              competitorId,
              fetchedAt,
              outcome,
              decision,
              changes,
              initialSummary: initialSummaryFor(decision, changes, fetchedAt),
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
