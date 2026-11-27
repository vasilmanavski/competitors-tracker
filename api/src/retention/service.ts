import type { DataAccess } from "../data-access.ts";

export type RetentionLogger = { info(obj: object, msg: string): void };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows deleted per statement: small enough to keep each delete short and lock-light. */
const DEFAULT_BATCH_SIZE = 5_000;

export type RetentionServiceDeps = {
  data: DataAccess;
  retentionDays: number;
  log: RetentionLogger;
  batchSize?: number;
  now?: () => Date;
};

/**
 * Keeps history bounded: uneventful snapshots older than the retention period are purged,
 * while changes, first snapshots and each competitor's latest complete listing are kept.
 */
export function createRetentionService(deps: RetentionServiceDeps) {
  const { data, retentionDays, log, batchSize = DEFAULT_BATCH_SIZE, now = () => new Date() } = deps;
  const { snapshotRepository } = data.repositories;

  return {
    /**
     * Deletes expired uneventful snapshots (older than `retentionDays` and recording no change)
     * in batches until none are left. Changes, first snapshots and each competitor's latest `ok`
     * listing are always kept. An abort stops it between batches; the next run finishes the rest.
     */
    async purgeExpiredSnapshots(signal?: AbortSignal): Promise<number> {
      const cutoff = new Date(now().getTime() - retentionDays * DAY_MS);
      let deleted = 0;
      while (!signal?.aborted) {
        const deletedInBatch = await snapshotRepository.deleteUneventfulBefore(cutoff, batchSize);
        deleted += deletedInBatch;
        if (deletedInBatch < batchSize) break;
      }
      if (deleted > 0) log.info({ deleted, cutoff, retentionDays }, "purged expired uneventful snapshots");
      return deleted;
    },
  };
}

export type RetentionService = ReturnType<typeof createRetentionService>;
