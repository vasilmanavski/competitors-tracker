# Epic 2 — Poll listings & store their history

_Scheduler → fetch → normalise → save snapshot → detect change → timeline UI_

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide

## Goal
**In one line:** regularly check every watched competitor's page, save each result, mark real changes, and show the history as a timeline.

Every tracked competitor is polled periodically within the source's global rate limit. Every poll result is stored as a snapshot, including failures, 404s and "no change". Each snapshot is marked `changed` when it differs in a way that matters from the competitor's previous state. The timeline UI shows all of it.

**Definition of done:** track `acme-crm`, then advance the source (`/control/advance`). The timeline shows a new snapshot with `changed: true` and the changed fields. Noise and format variants never produce a false `changed`. Injected failures show up as failed snapshots, and the scheduler keeps running.

This is the epic the graders weigh most: **persistence + scheduling**.

## Key concepts
- **Poll**: one `GET /listings/:id` for one competitor. It produces exactly one snapshot row.
- **Scheduler**: wakes up periodically and polls the competitors that are *due* (not polled within the interval), oldest first.
- **Normalise**: reduce the messy response to 4 clean fields, so the same content always looks the same.

## Scope
- Scheduler + global rate limiter + source HTTP client (timeouts, retries, `429`).
- Normalisation + validation of the listing.
- `snapshots` table + "changed" detection.
- `GET /api/competitors/:id/snapshots` (newest first).
- React **Competitor timeline** view.
- The "changed in last 24 h" indicator on the competitor list (moved here from Epic 1).
- A "never found at source" status on the competitor list, for ids whose polls have only ever returned `not_found`. This is the follow-up to decision 1.2: typos like `qweqweqweqeqe` are accepted on add and flagged here.

## Out of scope
- The LLM call (Epic 3). In this epic `summary` is always `null`, with a reason.
- Building production scale (partitioning, distributed workers). It's described in the README instead (Epic 4).

## How the source behaves (from its README; design for all of it)
- `200` with noise fields (`requestId`, `renderedAt`, `viewerCount`, `promoBanner`, `cache`), randomly ordered keys.
- The same values in different formats: `$39/mo`, `$39.00/mo`, `$39 / month`, `USD 39 per month`, `Free`/`$0/mo`/`Free forever`; padded whitespace, double spaces, `&amp;`, `&nbsp;`, trailing `\n`.
- Partial listings: one field missing, empty or `null`.
- `404`: the id is unknown **or** delisted right now. A competitor can come back later.
- `429` + `Retry-After` (seconds) above the **global** limit.
- `5xx`, sometimes with an HTML body. Slow responses (8 s). No response at all (the connection hangs for 60 s).

## Data model (draft)
```
competitors  (+ columns)
  next_poll_at    timestamptz not null default now()
  last_polled_at  timestamptz null

snapshots
  id              bigserial pk
  competitor_id   text fk -> competitors(id) on delete cascade
  fetched_at      timestamptz not null
  status          ok | partial | not_found | fetch_failed
  title, tagline, description        text null
  price_raw       text null            -- as displayed by the source
  price_amount    numeric null, price_currency text null, price_period text null
  changed         boolean not null
  changed_fields  text[] not null default '{}'
  summary         text null
  summary_status  text not null        -- why there is / isn't a summary (see below)
  error           text null            -- e.g. "HTTP 503", "timeout after 5s"
  index (competitor_id, fetched_at desc)
```
`summary_status` values in this epic: `first_snapshot`, `not_changed`, `fetch_failed`, `not_found`, `incomplete_listing`, `pending` (changed, waiting for Epic 3).

## API
```
GET /api/competitors/:id/snapshots -> 200 [Snapshot, ...]  // newest first
GET /api/competitors               -> adds "changedLast24h": boolean (and optionally lastPolledAt, lastStatus)
```
Snapshot fields: at least `fetchedAt, title, tagline, price, description, changed, summary`, plus `status, summaryStatus, changedFields, error`.

## Decisions
| # | Decision | Status |
|---|---|---|
| 2.1 | `changed` + the timeline UI belong in this epic, not in the LLM epic. | **DECIDED** |
| 2.2 | **Delisting and relisting count as changes** (`changed: true`). They're based only on a confirmed `not_found` (HTTP 404), **never** on `fetch_failed`. | **DECIDED** |
| 2.3 | **Every poll is stored**, including no-change, failed and not-found polls. The brief requires 90 days of history covering them. | **DECIDED** (brief) |
| 2.4 | Normalise to 4 fields; drop all noise. Text: decode `&amp;`/`&nbsp;`, trim, collapse whitespace. Price parsed into `{amount, currency, period}` and compared on that, not on the string. | **PROPOSED** (implemented) |
| 2.5 | "Changed" = any normalised field differs from the **last `ok` snapshot** (or ok↔not_found per 2.2). | **PROPOSED** (implemented) |
| 2.6 | A partial listing is stored as `partial`, `changed: false`, `summary_status: incomplete_listing`. It's never reported as "field removed", and never used as the comparison baseline. | **PROPOSED** (implemented) |
| 2.7 | One **global** token bucket for all source requests, default **4 req/s** (headroom under 5). Configurable. Capacity 1 = evenly spaced requests, no bursts. | **PROPOSED** (implemented) |
| 2.8 | On `429`: pause the *whole* limiter for `Retry-After` seconds, then retry that poll. | **PROPOSED** (implemented) |
| 2.9 | Request timeout ~5 s via `AbortSignal.timeout`. `5xx`/timeout/non-JSON → up to 2 retries with backoff, then a `fetch_failed` snapshot with the error stored. | **PROPOSED** (implemented) |
| 2.10 | The scheduler is a self-rescheduling `setTimeout` tick (never overlaps itself). It claims due rows by setting `next_poll_at = now() + interval` **before** fetching, so a slow poll is never picked twice. | **PROPOSED** (implemented) |
| 2.11 | Each poll is isolated with try/catch: one bad poll never stops the scheduler or other polls. | **PROPOSED** (implemented) |
| 2.12 | A newly added competitor is due immediately (`next_poll_at = now()`). | **PROPOSED** (implemented) |
| 2.13 | **Minor text edits count.** Whitespace/entity/format noise is already removed by normalisation, so any remaining text difference is a real edit by the competitor. Alternative considered: a similarity threshold (risks hiding real one-word changes like "no" → "now"). Deciding how *much* it matters is the summary's job (Epic 3). | **PROPOSED** (implemented) |
| 2.14 | **Before the first `ok`, a 404 means "never found at source"**: `changed: false`, list shows ⚠ never found. Only after an `ok` does a 404 mean "delisted" (`changed: true`). The first `ok` after never-found is a first snapshot, not a relisting. Tracked as `competitors.listing_state`: `unknown → never_listed / listed ↔ delisted`; `partial` and `fetch_failed` never move it. | **PROPOSED** (implemented) |
| 2.15 | **Changing `POLL_INTERVAL_SECONDS` applies from each competitor's next poll.** A competitor already scheduled under the old interval keeps its `next_poll_at` until it polls once more; the API does not reschedule on startup. To apply a new interval at once: `update competitors set next_poll_at = now()`. Considered: re-applying the interval at startup. Rejected as unnecessary. | **DECIDED** 2026-11-26 |

## Failure modes → what the user sees in the timeline
| Situation | Snapshot | UI shows |
|---|---|---|
| First successful poll | `ok`, `changed: false` | "First snapshot, nothing to compare" |
| Same content, different format/noise | `ok`, `changed: false` | "No change" |
| Real change | `ok`, `changed: true`, `changed_fields` | the fields; "summary pending" (until Epic 3) |
| Partial listing | `partial` | "Incomplete listing from source, ignored for comparison" |
| 404 | `not_found` | "Not listed at the source" (a change if it was listed before) |
| 5xx / timeout after retries | `fetch_failed`, `error` | "Fetch failed: <error>" |

## Stories
_Implemented 2026-11-26 on `epic-2-polling`, using the PROPOSED choices above (incl. 2.13 and 2.14). Confirm or change them in review._

1. **Schema + migration** (`api/src/db/schema.ts` → `api/drizzle/0002_snapshots.sql`). `snapshots` as drafted, plus `missing_fields` (what a partial listing lacked) and `price_text` (the source's cleaned wording). Check constraints on the status columns. Indexes: `(competitor_id, fetched_at desc)` for the timeline, and a partial one `WHERE status = 'ok'` for the change-detection baseline. `competitors` gets `next_poll_at`, `last_polled_at`, plus denormalised `last_status`, `last_changed_at`, `listing_state`, all written in the same transaction as each snapshot. The list view never scans snapshots.
2. **Normaliser** (`api/src/listings/normalize.ts`, pure): text = decode entities → collapse whitespace → trim; empty → missing. Price → `{amount, currency, period}`; every free wording → `{0, null, null}`. An unknown price format is kept as text and compared as text.
3. **Change detection** (`api/src/listings/change-detection.ts`, pure): decisions 2.2, 2.5, 2.6, 2.13, 2.14 in one `switch`. `changed_fields` uses `availability` for delisting/relisting.
4. **Rate limiter** (`api/src/source/rate-limiter.ts`): global, evenly spaced; `pauseFor()` on 429 holds back every caller.
5. **Source client** (`api/src/source/source-client.ts`): 5 s timeout per attempt (covers headers *and* body), 2 retries with ×3 backoff + jitter on 5xx / timeout / network / non-JSON. 429s wait `Retry-After` and don't use up the retry budget. Never throws except on shutdown abort. The stored error lists each attempt (`3 attempts: HTTP 503, HTTP 502, timeout after 5000 ms`).
6. **Poller + scheduler** (`api/src/polling/`): tick every 1 s → `claimDue` (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, oldest due first) → start polls without awaiting them. In-flight polls are capped at `rate × timeout` (20). `recordPoll` locks the competitor row, reads the last `ok`, decides, inserts and updates in one transaction. A competitor deleted mid-poll → the poll is dropped. On shutdown: stop claiming, abort in-flight polls, wait.
7. **API**: `GET /api/competitors/:id/snapshots?limit=&before=` (newest first, default 100, max 500, 404 if untracked). The list adds `lastPolledAt, lastStatus, lastChangedAt, changedLast24h, listingState, neverFound`.
8. **UI**: hash router (`#/competitors/<id>`), `Timeline.tsx` (fields with changed ones highlighted, status, change label, summary or the reason there is none, "Load older"), list badges for *changed in last 24 h* and *never found at source*. Both views refresh every 15 s (see story 13 for faster refresh).
9. **Config**: `SOURCE_RATE_LIMIT_PER_SECOND` default 5 → **4**; new `SOURCE_TIMEOUT_MS` (5000), `SOURCE_MAX_RETRIES` (2), `SCHEDULER_ENABLED` (true).

**Added on review (same PR #2, before merge):**

10. **Service layer refactor** (PR #3, merged into this branch): routes → services → repositories, domain errors mapped in one error handler, JSDoc-only comments, layer-specific method names (`docs/pushbacks.md` #1–#4). Project rule: `.claude/skills/clean-code/SKILL.md`.
11. **UI restyle to the mockup**: dark page, one white card per view; list = full-width id input + **Track**, rows with link left / **Remove** right, small badges and a muted "last poll … · status" line; timeline = **← Back to competitors**, cards as "**Title** — tagline / price / description", changed fields highlighted.
12. **First poll without a manual refresh**: while a competitor has no poll yet (list) or a timeline is empty, the view re-reads the API every **1 s** instead of 15 s, then drops back (`useAutoRefresh.ts`, `AWAITING_REFRESH_MS` / `IDLE_REFRESH_MS`). Verified in Chrome: the row updated ~1.5 s after **Track**.
13. **Loading indicator**: a spinner with "Fetching listing…" on a new row and "Fetching the first listing from the source…" on an empty timeline (`PollingIndicator.tsx`); the last-poll line and new cards fade in; animations off under `prefers-reduced-motion`.
14. **Collapsed uneventful polls**: consecutive "no change" polls (and repeated 404s) show as one row, "✓ No change · 46 checks · 12:00 – 17:17", which expands to every check's time; firsts, changes, failures and incomplete listings stay full cards (`timeline/group-snapshots.ts`, unit-tested). "Last checked N ago" under the title. Timeline pages are 200 snapshots. Every poll is still stored and reachable (the brief's 90-day requirement).
15. **Interval changes** behave as in 2.15.

**Tests** (`npm test`, 97 total at first merge; root `npm test` also runs the web tests since story 14): normaliser (every format variant from the source README), change detection, limiter (virtual clock), client against a scripted misbehaving HTTP server, and an integration test (poller + scheduler + API on real Postgres) that walks a listing through first → same → partial → change → failure → delisted → relisted. Test files now run one at a time (`--test-concurrency=1`) because they share the test DB.

## Verification (source control endpoints, `localhost:4002`)
```bash
curl -X POST localhost:4002/control/configure -d '{"failNext":3}'          # retries then fetch_failed; scheduler continues
curl -X POST localhost:4002/control/configure -d '{"rateLimitPerSecond":1}' # 429s handled, no poll lost
curl -X POST localhost:4002/control/configure -d '{"partialNext":2}'       # no false "changed"
curl -X POST localhost:4002/control/configure -d '{"timeoutNext":1}'       # timeout fires, next tick still runs
curl -X POST localhost:4002/control/advance  -d '{"id":"acme-crm"}'        # a real change appears
curl localhost:4002/control/stats                                          # request rate stays within limit
```
Unit tests for the normaliser cover every price/text format listed above.

**Results (2026-11-26, local, provided source with `SEED=42`, 6 competitors, interval 5 s):**
- Steady state: every format variant → `not_changed`; zero false `changed`; zero 429s at 4 req/s.
- `advance acme-crm` ×2 → next poll `changed: true, ["price"]`, $39/mo → $29/mo.
- `failNext: 3` → absorbed by retries (no failed snapshot, as intended). `failNext: 40` → `fetch_failed` snapshots with `HTTP 50x (3 attempts)`; the scheduler kept polling the rest.
- `partialNext: 2` → `partial`, `incomplete_listing`, `changed: false`, missing field recorded.
- `timeoutNext: 1` → timeout after 5 s, retried; other polls carried on.
- `rateLimitPerSecond: 1` (demand 1.2/s) for 20 s → 14 × 429, all retried after `Retry-After`; 16 polls stored, 0 lost.
- `ferry-pay` advanced into its delisted version and back → `not_found, changed, [availability]`, then `ok, changed, [availability]`.
- Unknown id `qweqweqweqeqe` → `not_found`, never `changed`, list shows ⚠ never found.

## Decision log → README
- What counts as a change (2.4–2.6, 2.2) and what was considered instead.
- Rate-limit + 429 strategy (2.7, 2.8); retries and timeouts (2.9).
- How history is stored (2.3) and how it scales (link to Epic 4).
