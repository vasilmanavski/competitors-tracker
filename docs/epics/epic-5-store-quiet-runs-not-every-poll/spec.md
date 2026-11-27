# Epic 5 — Store quiet runs, not every poll

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide
>
> **Status: done** — implemented and merged 2026-11-27 (PR #10, squash-merged). This spec reflects the final state.

## Goal
**In one line:** a stretch of uneventful polls is stored as one row with a check count, not one row per poll.

At the brief's numbers (6,000 competitors, a poll every 15 min) most rows were unchanged polls carrying a full copy of a listing we already had: about 345,600 rows a day under the rate limit, around 31M over 90 days. The timeline already showed those polls as one line (`No change · 30 checks · 10:13 – 10:21`), so storage now matches what the UI shows.

**Definition of done:** 30 unchanged polls in a row are one `snapshots` row with `check_count = 30`; the timeline line, the retention rules and change detection behave as before.

## Decision log

| # | Decision | Status |
|---|---|---|
| 5.1 | **One row per quiet run** (option 2 of two discussed). A poll that is uneventful in the same way as the competitor's newest snapshot (`not_changed` after `not_changed`, or `not_found` after `not_found`) extends that row: `last_checked_at = fetched_at`, `check_count + 1`. Anything else inserts a new row as before. Rejected: keep a row per poll but drop the listing copy on unchanged polls (cuts bytes, keeps ~52M rows). | **DECIDED** 2026-11-27 |
| 5.2 | **Only the two kinds the timeline already collapses form runs.** Failures, incomplete listings, firsts and changes stay one row each, so each still gets its own card. A failure or change between two quiet polls ends the run. | **DECIDED** 2026-11-27 |
| 5.3 | **A run holds the listing of its latest poll.** Each extension also rewrites the listing columns. Polls in a run are equal on the 4 compared fields by definition, so the row stays a valid change-detection baseline, and the raw wording (`priceRaw`) is the source's current one rather than the run's first. _Revised on review: it first kept the first poll's listing._ | **DECIDED** 2026-11-27 |
| 5.4 | **What's lost:** the time of each individual check inside a run. The count, the first check and the last check stay. A gap (e.g. the service was down for a day) stays inside the run's time range; the count is still exact. | **DECIDED** 2026-11-27 |
| 5.5 | **Retention expires a run by its last check** (`last_checked_at < cutoff`). A run that straddles the cutoff is kept whole: the brief asks for at least 90 days, so keeping a little more is safe. The partial index moves from `fetched_at` to `last_checked_at`. **Each competitor's newest row is never purged** (added on review): retention doesn't take the competitor lock, so after a 90+ day outage it could delete the run a poll is extending, or delete a newest failure so the next quiet poll extends the run before it across that failure. | **DECIDED** 2026-11-27 |
| 5.6 | **Existing rows are not merged into runs.** The migration sets `last_checked_at = fetched_at` and `check_count = 1` on old rows. The timeline still groups adjacent run rows and sums their counts, so old and new data look the same, and retention removes the old rows within 90 days. | **DECIDED** 2026-11-27 |
| 5.7 | **API:** each snapshot gains `lastCheckedAt` and `checkCount` (1 for every event). Ordering and `before` paging stay on `fetchedAt`, the start of the row. | **DECIDED** 2026-11-27 |
| 5.8 | **The migration rewrites the table** (one `UPDATE` to backfill `last_checked_at`, then `SET NOT NULL`). Instant at this project's size. On a production table of tens of millions of rows it would hold row locks for minutes, so there I'd add the column nullable, backfill in batches, and validate the constraint afterwards. | **DECIDED** 2026-11-27 |

## Stories
1. **Schema + migration `0006_quiet_runs.sql`:** `snapshots.last_checked_at` (backfilled from `fetched_at`, then `NOT NULL`) and `check_count integer NOT NULL DEFAULT 1`; `snapshots_uneventful_fetched_idx` replaced by `snapshots_uneventful_last_checked_idx`.
2. **`SnapshotService.recordPoll`:** in the same locked transaction, read the competitor's newest snapshot; extend it when 5.1 applies (refreshing its listing, 5.3), otherwise insert. Repository: `findNewest`, `extendQuietRun`.
3. **Retention:** `deleteUneventfulBefore` filters on `last_checked_at` and skips each competitor's newest row.
4. **DTO + web:** `lastCheckedAt` / `checkCount` in the snapshot JSON; the quiet-run line sums `checkCount` and runs from the oldest `fetchedAt` to the newest `lastCheckedAt`; "Last checked" uses the newest `lastCheckedAt`.
5. **Tests:** polling integration (unchanged polls extend one run; a change or failure ends it; a run keeps the latest wording; paging across runs returns every row once and every check), retention (runs expire by last check; the newest row survives a long outage; batching across many rows), web grouping (counts and range).
6. **Docs:** README "How history is stored" and production section 3; notes on Epic 2 (2.3, story 14) and Epic 4 (4.5).
