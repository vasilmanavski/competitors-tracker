import type { DataAccess } from "../data-access.ts";
import type { SummaryStatus } from "../db/schema.ts";
import type { ChangedField } from "../listings/change-detection.ts";
import type { FieldChange } from "../listings/field-changes.ts";
import type { Snapshot, SummaryUpdate } from "../snapshots/repository.ts";
import type { CompletionResult, LlmClient } from "./llm-client.ts";
import { buildSummaryPrompt } from "./prompt.ts";
import { checkSummary } from "./summary-check.ts";

export type SummaryLogger = {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
};

const MINUTE_MS = 60_000;

/** Waits before retrying a timed-out or failed summary; its length is the number of retries. */
export const DEFAULT_RETRY_DELAYS_MS = [MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS];

/** How long a claimed snapshot stays reserved; longer than any LLM call. */
const CLAIM_LEASE_SECONDS = 120;

const AWAITING_SUMMARY: ReadonlySet<SummaryStatus> = new Set(["pending", "llm_timeout", "llm_failed", "daily_cap_reached"]);

export type SummaryServiceDeps = {
  data: DataAccess;
  llm: LlmClient;
  dailyCap: number;
  log: SummaryLogger;
  retryDelaysMs?: number[];
  now?: () => Date;
};

/** The next UTC midnight, when the daily cap resets. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Snapshots stored before changes were recorded only know which fields changed. */
function changesForPrompt(snapshot: Snapshot): FieldChange[] {
  if (snapshot.changes.length > 0) return snapshot.changes;
  return snapshot.changedFields.map((field) => ({ field: field as ChangedField, before: null, after: null }));
}

/** Generates and stores AI summaries for changed snapshots, within the daily cap. */
export function createSummaryService(deps: SummaryServiceDeps) {
  const { data, llm, dailyCap, log, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS, now = () => new Date() } = deps;
  const { snapshotRepository, llmUsageRepository } = data.repositories;

  function retryOrGiveUp(snapshot: Snapshot, status: "llm_timeout" | "llm_failed", error: string): SummaryUpdate {
    const attempts = snapshot.summaryAttempts + 1;
    const delayMs = retryDelaysMs[attempts - 1];
    const nextAttemptAt = delayMs === undefined ? null : new Date(now().getTime() + delayMs);
    return {
      summaryStatus: status,
      summary: null,
      summaryError: error,
      summaryAttempts: attempts,
      summaryNextAttemptAt: nextAttemptAt,
      summarySource: null,
    };
  }

  function final(snapshot: Snapshot, status: SummaryStatus, summary: string | null, error: string | null): SummaryUpdate {
    return {
      summaryStatus: status,
      summary,
      summaryError: error,
      summaryAttempts: snapshot.summaryAttempts + 1,
      summaryNextAttemptAt: null,
      summarySource: summary === null ? null : "llm",
    };
  }

  function deferToNextDay(snapshot: Snapshot): SummaryUpdate {
    return {
      summaryStatus: "daily_cap_reached",
      summary: null,
      summaryError: null,
      summaryAttempts: snapshot.summaryAttempts,
      summaryNextAttemptAt: nextUtcMidnight(now()),
      summarySource: null,
    };
  }

  function updateFor(snapshot: Snapshot, result: CompletionResult): SummaryUpdate {
    switch (result.kind) {
      case "answer": {
        const check = checkSummary(result.content, result.finishReason);
        return check.kind === "usable"
          ? final(snapshot, "summarized", check.summary, null)
          : final(snapshot, "unusable_output", null, check.reason);
      }
      case "malformed":
        return final(snapshot, "unusable_output", null, result.reason);
      case "timeout":
        return retryOrGiveUp(snapshot, "llm_timeout", "the LLM did not answer in time");
      case "failed":
        return retryOrGiveUp(snapshot, "llm_failed", result.error);
    }
  }

  async function requestSummary(snapshot: Snapshot, signal?: AbortSignal): Promise<SummaryUpdate> {
    if (!(await llmUsageRepository.incrementCallsIfBelow(dailyCap))) return deferToNextDay(snapshot);
    const prompt = buildSummaryPrompt({ competitorId: snapshot.competitorId, title: snapshot.title, changes: changesForPrompt(snapshot) });
    return updateFor(snapshot, await llm.complete(prompt, signal));
  }

  return {
    /** Claims up to `limit` snapshots whose summary is due, skipping the ones being worked on. */
    async claimDue(limit: number, excludeIds: string[]): Promise<string[]> {
      const ids = await snapshotRepository.claimSummaryDue(limit, CLAIM_LEASE_SECONDS, excludeIds.map(Number));
      return ids.map(String);
    },

    /**
     * Makes one summary attempt for a changed snapshot and stores the outcome. The
     * snapshot itself was saved by the poll, so nothing here can lose it.
     */
    async summarizeSnapshot(snapshotId: string, signal?: AbortSignal): Promise<void> {
      const snapshot = await snapshotRepository.findById(Number(snapshotId));
      if (!snapshot || !AWAITING_SUMMARY.has(snapshot.summaryStatus)) return;

      const update = await requestSummary(snapshot, signal);
      await snapshotRepository.updateSummary(snapshot.id, update);

      const fields = { snapshotId: snapshot.id, competitorId: snapshot.competitorId, status: update.summaryStatus, retryAt: update.summaryNextAttemptAt };
      if (update.summaryStatus === "summarized") log.info(fields, "summary stored");
      else log.warn({ ...fields, error: update.summaryError }, "no summary");
    },
  };
}

export type SummaryService = ReturnType<typeof createSummaryService>;
