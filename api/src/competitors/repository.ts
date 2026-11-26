import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { competitors } from "../db/schema.ts";

export type Competitor = { id: string; createdAt: Date };

export function competitorRepository(db: Db) {
  return {
    list(): Promise<Competitor[]> {
      return db.select().from(competitors).orderBy(asc(competitors.createdAt), asc(competitors.id));
    },

    // Returns null when the id is already tracked. ON CONFLICT DO NOTHING keeps
    // this a single statement, so two concurrent adds can't both succeed.
    async create(id: string): Promise<Competitor | null> {
      const rows = await db.insert(competitors).values({ id }).onConflictDoNothing().returning();
      return rows[0] ?? null;
    },

    // Hard delete (decision 1.1). Snapshots (Epic 2) go with it via ON DELETE CASCADE.
    // Returns false when nothing was deleted.
    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(competitors)
        .where(eq(competitors.id, id))
        .returning({ id: competitors.id });
      return rows.length > 0;
    },
  };
}

export type CompetitorRepository = ReturnType<typeof competitorRepository>;
