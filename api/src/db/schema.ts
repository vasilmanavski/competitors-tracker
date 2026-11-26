import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Drizzle table definitions. `npm run db:generate` diffs this file against
// the last migration snapshot and writes a new SQL migration into ./drizzle.

// A rival product we watch. The id is the source's listing id (e.g. "acme-crm").
// Epic 2 adds scheduling columns (next_poll_at, last_polled_at) and snapshots,
// which reference this table with ON DELETE CASCADE (decision 1.1).
export const competitors = pgTable("competitors", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
