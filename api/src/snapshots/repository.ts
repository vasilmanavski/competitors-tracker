import { and, desc, eq, lt } from "drizzle-orm";
import type { DbExecutor } from "../db/client.ts";
import { snapshots } from "../db/schema.ts";
import type { ChangeDecision, PollOutcome } from "../listings/change-detection.ts";
import type { Price, PricePeriod } from "../listings/normalize.ts";

export type Snapshot = typeof snapshots.$inferSelect;

/** One poll result, ready to be stored. */
export type NewSnapshot = {
  competitorId: string;
  fetchedAt: Date;
  outcome: PollOutcome;
  decision: ChangeDecision;
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

function toRow({ competitorId, fetchedAt, outcome, decision }: NewSnapshot) {
  return {
    competitorId,
    fetchedAt,
    status: outcome.status,
    ...listingColumns(outcome),
    changed: decision.changed,
    changedFields: decision.changedFields,
    summary: null,
    summaryStatus: decision.summaryStatus,
    error: outcome.status === "fetch_failed" ? outcome.error : null,
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

    async insert(snapshot: NewSnapshot): Promise<Snapshot> {
      const [row] = await db.insert(snapshots).values(toRow(snapshot)).returning();
      if (!row) throw new Error("insert into snapshots returned no row");
      return row;
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
