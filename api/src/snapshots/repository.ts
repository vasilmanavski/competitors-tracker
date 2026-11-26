import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { competitors, snapshots } from "../db/schema.ts";
import { type ChangeDecision, comparable, detectChange, type PollOutcome } from "../listings/change-detection.ts";
import type { Price, PricePeriod } from "../listings/normalize.ts";

export type Snapshot = typeof snapshots.$inferSelect;

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
  const l = outcome.listing;
  return {
    title: l.title,
    tagline: l.tagline,
    description: l.description,
    priceText: l.priceText,
    priceAmount: l.price?.amount ?? null,
    priceCurrency: l.price?.currency ?? null,
    pricePeriod: l.price?.period ?? null,
    missingFields: l.missing,
  };
}

export function snapshotRepository(db: Db) {
  return {
    /**
     * Stores one poll result and decides whether it changed something, in one
     * transaction. Locking the competitor row (FOR UPDATE) serialises polls of
     * the same competitor, so the baseline we compare against can't move under
     * us, and tells us if the competitor was removed while we were fetching.
     *
     * Returns null when the competitor no longer exists (the poll is dropped).
     */
    async recordPoll(
      competitorId: string,
      outcome: PollOutcome,
      fetchedAt: Date,
    ): Promise<{ snapshot: Snapshot; decision: ChangeDecision } | null> {
      return db.transaction(async (tx) => {
        const [competitor] = await tx
          .select({ listingState: competitors.listingState })
          .from(competitors)
          .where(eq(competitors.id, competitorId))
          .for("update");
        if (!competitor) return null;

        const [lastOk] = await tx
          .select()
          .from(snapshots)
          .where(and(eq(snapshots.competitorId, competitorId), eq(snapshots.status, "ok")))
          .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
          .limit(1);
        const baseline = lastOk ? comparable({ ...lastOk, price: priceOf(lastOk) }) : null;

        const decision = detectChange(outcome, baseline, competitor.listingState);

        const [snapshot] = await tx
          .insert(snapshots)
          .values({
            competitorId,
            fetchedAt,
            status: outcome.status,
            ...listingColumns(outcome),
            changed: decision.changed,
            changedFields: decision.changedFields,
            summary: null, // Epic 3
            summaryStatus: decision.summaryStatus,
            error: outcome.status === "fetch_failed" ? outcome.error : null,
          })
          .returning();

        await tx
          .update(competitors)
          .set({
            lastPolledAt: fetchedAt,
            lastStatus: outcome.status,
            listingState: decision.nextListingState,
            ...(decision.changed ? { lastChangedAt: fetchedAt } : {}),
          })
          .where(eq(competitors.id, competitorId));

        return { snapshot: snapshot!, decision };
      });
    },

    // Newest first. `before` is an exclusive fetchedAt cursor for "load older".
    list(competitorId: string, opts: { limit: number; before?: Date }): Promise<Snapshot[]> {
      return db
        .select()
        .from(snapshots)
        .where(
          and(
            eq(snapshots.competitorId, competitorId),
            opts.before ? lt(snapshots.fetchedAt, opts.before) : undefined,
          ),
        )
        .orderBy(desc(snapshots.fetchedAt), desc(snapshots.id))
        .limit(opts.limit);
    },

    /**
     * Decision 2.10: claim up to `limit` due competitors, oldest-due first, by
     * pushing their next_poll_at one interval ahead *before* fetching. A slow
     * poll is therefore never picked again by the next tick, and SKIP LOCKED lets
     * several API instances share the work without double-polling.
     *
     * The next poll is scheduled from the claim time, not from the old due time:
     * when we fall behind (6,000 × every 15 min doesn't fit in 5 req/s), every
     * competitor keeps getting polled in turn and the effective interval
     * stretches, instead of a backlog piling up.
     */
    async claimDue(limit: number, intervalSeconds: number, excludeIds: string[] = []): Promise<string[]> {
      if (limit <= 0) return [];
      const exclude = excludeIds.length > 0 ? excludeIds : [""];
      const result = await db.execute<{ id: string }>(sql`
        update ${competitors} set next_poll_at = now() + make_interval(secs => ${intervalSeconds})
        where id in (
          select id from ${competitors}
          where next_poll_at <= now() and id <> all(${sql.param(exclude)}::text[])
          order by next_poll_at, id
          limit ${limit}
          for update skip locked
        )
        returning id`);
      return result.rows.map((r) => r.id);
    },
  };
}

export type SnapshotRepository = ReturnType<typeof snapshotRepository>;
