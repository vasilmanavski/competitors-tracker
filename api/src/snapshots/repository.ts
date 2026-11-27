import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { DbExecutor } from "../db/client.ts";
import { SUMMARY_SOURCES, type SummaryStatus, snapshots } from "../db/schema.ts";
import type { ChangeDecision, PollOutcome } from "../listings/change-detection.ts";
import type { FieldChange } from "../listings/field-changes.ts";
import type { Price, PricePeriod } from "../listings/normalize.ts";

export type Snapshot = typeof snapshots.$inferSelect;

/** One poll result, ready to be stored. */
export type NewSnapshot = {
  competitorId: string;
  fetchedAt: Date;
  outcome: PollOutcome;
  decision: ChangeDecision;
  changes: FieldChange[];
  initialSummary: InitialSummary;
};

export type SummarySource = (typeof SUMMARY_SOURCES)[number];

/** The summary a snapshot starts with: written by our rules, queued for the LLM, or not needed. */
export type InitialSummary = {
  status: SummaryStatus;
  text: string | null;
  source: SummarySource | null;
  /** When the summary worker should pick it up; null when no LLM call is needed. */
  dueAt: Date | null;
};

/** The result of one summary attempt, written back onto the snapshot. */
export type SummaryUpdate = {
  summaryStatus: SummaryStatus;
  summary: string | null;
  summaryError: string | null;
  summaryAttempts: number;
  summaryNextAttemptAt: Date | null;
  summarySource: SummarySource | null;
};

/** A page of the timeline: newest first, strictly older than `before` when given. */
export type TimelinePage = { limit: number; before?: Date };

/** Rebuilds the parsed price from its columns; null when the price wasn't understood. */
export function priceOf(row: Pick<Snapshot, "priceAmount" | "priceCurrency" | "pricePeriod">): Price | null {
  if (row.priceAmount === null) return null;
  return {
    amount: Number(row.priceAmount),
    currency: row.priceCurrency,
    period: row.pricePeriod as PricePeriod | null,
  };
}

function listingColumns(outcome: PollOutcome) {
  if (outcome.status !== "ok" && outcome.status !== "partial") return {};
  const { listing } = outcome;
  return {
    title: listing.title,
    tagline: listing.tagline,
    description: listing.description,
    priceText: listing.priceText,
    priceAmount: listing.price?.amount ?? null,
    priceCurrency: listing.price?.currency ?? null,
    pricePeriod: listing.price?.period ?? null,
    missingFields: listing.missing,
  };
}

function toRow({ competitorId, fetchedAt, outcome, decision, changes, initialSummary }: NewSnapshot) {
  return {
    competitorId,
    fetchedAt,
    lastCheckedAt: fetchedAt,
    status: outcome.status,
    ...listingColumns(outcome),
    changed: decision.changed,
    changedFields: decision.changedFields,
    summary: initialSummary.text,
    summaryStatus: initialSummary.status,
    summarySource: initialSummary.source,
    error: outcome.status === "fetch_failed" ? outcome.error : null,
    changes,
    summaryNextAttemptAt: initialSummary.dueAt,
  };
}

const newestFirst = [desc(snapshots.fetchedAt), desc(snapshots.id)];

/** SQL access to the `snapshots` table. */
export function createSnapshotRepository(db: DbExecutor) {
  return {
    async findLatestOk(competitorId: string): Promise<Snapshot | null> {
      const [row] = await db
        .select()
        .from(snapshots)
        .where(and(eq(snapshots.competitorId, competitorId), eq(snapshots.status, "ok")))
        .orderBy(...newestFirst)
        .limit(1);
      return row ?? null;
    },

    async findNewest(competitorId: string): Promise<Snapshot | null> {
      const [row] = await db
        .select()
        .from(snapshots)
        .where(eq(snapshots.competitorId, competitorId))
        .orderBy(...newestFirst)
        .limit(1);
      return row ?? null;
    },

    async insert(snapshot: NewSnapshot): Promise<Snapshot> {
      const [row] = await db.insert(snapshots).values(toRow(snapshot)).returning();
      if (!row) throw new Error("insert into snapshots returned no row");
      return row;
    },

    /**
     * Counts one more check on a quiet run instead of storing a new row. The listing is
     * refreshed to the latest poll, so a later change shows the source's current wording.
     */
    async extendQuietRun(id: number, checkedAt: Date, outcome: PollOutcome): Promise<Snapshot> {
      const [row] = await db
        .update(snapshots)
        .set({ ...listingColumns(outcome), lastCheckedAt: checkedAt, checkCount: sql`${snapshots.checkCount} + 1` })
        .where(eq(snapshots.id, id))
        .returning();
      if (!row) throw new Error(`quiet run ${id} to extend was not found`);
      return row;
    },

    async findById(id: number): Promise<Snapshot | null> {
      const [row] = await db.select().from(snapshots).where(eq(snapshots.id, id));
      return row ?? null;
    },

    /**
     * Claims up to `limit` snapshots whose summary is due, newest change first, by pushing
     * their next attempt one lease ahead. If the worker dies mid-call, the snapshot is
     * picked up again when the lease runs out. SKIP LOCKED lets several instances share the work.
     */
    async claimSummaryDue(limit: number, leaseSeconds: number, excludeIds: number[] = []): Promise<number[]> {
      if (limit <= 0) return [];
      const exclude = excludeIds.length > 0 ? excludeIds : [0];
      const result = await db.execute<{ id: string }>(sql`
        update ${snapshots} set summary_next_attempt_at = now() + make_interval(secs => ${leaseSeconds})
        where id in (
          select id from ${snapshots}
          where summary_next_attempt_at <= now() and id <> all(${sql.param(exclude)}::bigint[])
          order by fetched_at desc, id desc
          limit ${limit}
          for update skip locked
        )
        returning id`);
      return result.rows.map((row) => Number(row.id));
    },

    async updateSummary(id: number, update: SummaryUpdate): Promise<void> {
      await db.update(snapshots).set(update).where(eq(snapshots.id, id));
    },

    /**
     * Deletes up to `limit` uneventful snapshots (no change: unchanged, incomplete, failed or
     * still-not-listed polls) last checked before `cutoff`, so a quiet run goes only once all
     * of it has expired. Changes and first snapshots are history
     * worth keeping, and each competitor's latest complete listing is kept because it is the
     * baseline the next poll is compared with, however old it is. Each competitor's newest row
     * is kept too: the next poll may extend it, and it marks where the last quiet run ended.
     * @returns how many rows were deleted
     */
    async deleteUneventfulBefore(cutoff: Date, limit: number): Promise<number> {
      const result = await db.execute(sql`
        delete from ${snapshots}
        where id in (
          select s.id from ${snapshots} s
          where s.last_checked_at < ${cutoff}
            and not s.changed
            and s.summary_status <> 'first_snapshot'
            and s.id <> coalesce((
              select ok.id from ${snapshots} ok
              where ok.competitor_id = s.competitor_id and ok.status = 'ok'
              order by ok.fetched_at desc, ok.id desc
              limit 1
            ), 0)
            and s.id <> (
              select n.id from ${snapshots} n
              where n.competitor_id = s.competitor_id
              order by n.fetched_at desc, n.id desc
              limit 1
            )
          limit ${limit}
        )`);
      return result.rowCount ?? 0;
    },

    findNewestFirst(competitorId: string, page: TimelinePage): Promise<Snapshot[]> {
      return db
        .select()
        .from(snapshots)
        .where(
          and(
            eq(snapshots.competitorId, competitorId),
            page.before ? lt(snapshots.fetchedAt, page.before) : undefined,
          ),
        )
        .orderBy(...newestFirst)
        .limit(page.limit);
    },
  };
}

export type SnapshotRepository = ReturnType<typeof createSnapshotRepository>;
