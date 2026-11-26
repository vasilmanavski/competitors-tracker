import { asc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../db/client.ts";
import { competitors, type ListingState, type SnapshotStatus } from "../db/schema.ts";

export type Competitor = typeof competitors.$inferSelect;

/** What one poll changes on the competitor row. */
export type PollResultUpdate = {
  polledAt: Date;
  status: SnapshotStatus;
  listingState: ListingState;
  changed: boolean;
};

/** SQL access to the `competitors` table. */
export function createCompetitorRepository(db: DbExecutor) {
  return {
    /** All tracked competitors, oldest first. */
    list(): Promise<Competitor[]> {
      return db.select().from(competitors).orderBy(asc(competitors.createdAt), asc(competitors.id));
    },

    async exists(id: string): Promise<boolean> {
      const rows = await db.select({ id: competitors.id }).from(competitors).where(eq(competitors.id, id));
      return rows.length > 0;
    },

    /** Inserts the competitor; returns null when the id is already tracked. Safe under concurrent adds. */
    async create(id: string): Promise<Competitor | null> {
      const rows = await db.insert(competitors).values({ id }).onConflictDoNothing().returning();
      return rows[0] ?? null;
    },

    /** Deletes the competitor and, by cascade, its snapshots. Returns false when nothing was deleted. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(competitors).where(eq(competitors.id, id)).returning({ id: competitors.id });
      return rows.length > 0;
    },

    /** Locks the row until the transaction ends; returns null when the competitor no longer exists. */
    async lockForUpdate(id: string): Promise<Pick<Competitor, "listingState"> | null> {
      const [row] = await db
        .select({ listingState: competitors.listingState })
        .from(competitors)
        .where(eq(competitors.id, id))
        .for("update");
      return row ?? null;
    },

    async recordPollResult(id: string, update: PollResultUpdate): Promise<void> {
      await db
        .update(competitors)
        .set({
          lastPolledAt: update.polledAt,
          lastStatus: update.status,
          listingState: update.listingState,
          ...(update.changed ? { lastChangedAt: update.polledAt } : {}),
        })
        .where(eq(competitors.id, id));
    },

    /**
     * Claims up to `limit` due competitors, oldest-due first, by moving their
     * `next_poll_at` one interval ahead before they are fetched. SKIP LOCKED lets
     * several instances share the work without polling the same competitor twice.
     * When polling falls behind, the interval stretches instead of a backlog growing.
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
      return result.rows.map((row) => row.id);
    },
  };
}

export type CompetitorRepository = ReturnType<typeof createCompetitorRepository>;
