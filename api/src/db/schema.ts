import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** What one poll produced. Every poll is stored, whatever happened. */
export const SNAPSHOT_STATUSES = ["ok", "partial", "not_found", "fetch_failed"] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

/** Why a snapshot does or doesn't have a summary. */
export const SUMMARY_STATUSES = [
  "first_snapshot",
  "not_changed",
  "fetch_failed",
  "not_found",
  "incomplete_listing",
  "pending",
] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** What we know about the competitor at the source, from confirmed answers (200 or 404) only. */
export const LISTING_STATES = ["unknown", "listed", "never_listed", "delisted"] as const;
export type ListingState = (typeof LISTING_STATES)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * A tracked competitor. The `last_*` and `listing_state` columns summarise its
 * snapshots and are written in the same transaction, so the list view reads one table.
 */
export const competitors = pgTable(
  "competitors",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull().defaultNow(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastStatus: text("last_status", { enum: SNAPSHOT_STATUSES }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    listingState: text("listing_state", { enum: LISTING_STATES }).notNull().default("unknown"),
  },
  (t) => [
    index("competitors_next_poll_at_idx").on(t.nextPollAt),
    check("competitors_listing_state_check", sql`${t.listingState} in (${inList(LISTING_STATES)})`),
  ],
);

/** One row per poll. Deleting a competitor deletes its history. */
export const snapshots = pgTable(
  "snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: SNAPSHOT_STATUSES }).notNull(),
    title: text("title"),
    tagline: text("tagline"),
    description: text("description"),
    priceText: text("price_text"),
    priceAmount: numeric("price_amount", { precision: 12, scale: 2, mode: "number" }),
    priceCurrency: text("price_currency"),
    pricePeriod: text("price_period"),
    changed: boolean("changed").notNull(),
    changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
    missingFields: text("missing_fields").array().notNull().default(sql`'{}'::text[]`),
    summary: text("summary"),
    summaryStatus: text("summary_status", { enum: SUMMARY_STATUSES }).notNull(),
    error: text("error"),
  },
  (t) => [
    index("snapshots_competitor_fetched_idx").on(t.competitorId, t.fetchedAt.desc()),
    index("snapshots_last_ok_idx")
      .on(t.competitorId, t.fetchedAt.desc())
      .where(sql`${t.status} = 'ok'`),
    check("snapshots_status_check", sql`${t.status} in (${inList(SNAPSHOT_STATUSES)})`),
    check(
      "snapshots_summary_status_check",
      sql`${t.summaryStatus} in (${inList(SUMMARY_STATUSES)})`,
    ),
  ],
);
