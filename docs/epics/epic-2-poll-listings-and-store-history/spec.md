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
| 2.4 | Normalise to 4 fields; drop all noise. Text: decode `&amp;`/`&nbsp;`, trim, collapse whitespace. Price parsed into `{amount, currency, period}` and compared on that, not on the string. | **PROPOSED** |
| 2.5 | "Changed" = any normalised field differs from the **last `ok` snapshot** (or ok↔not_found per 2.2). | **PROPOSED** |
| 2.6 | A partial listing is stored as `partial`, `changed: false`, `summary_status: incomplete_listing`. It's never reported as "field removed", and never used as the comparison baseline. | **PROPOSED** |
| 2.7 | One **global** token bucket for all source requests, default **4 req/s** (headroom under 5). Configurable. | **PROPOSED** |
| 2.8 | On `429`: pause the *whole* limiter for `Retry-After` seconds, then retry that poll. | **PROPOSED** |
| 2.9 | Request timeout ~5 s via `AbortSignal.timeout`. `5xx`/timeout/non-JSON → up to 2 retries with backoff, then a `fetch_failed` snapshot with the error stored. | **PROPOSED** |
| 2.10 | The scheduler is a self-rescheduling `setTimeout` tick (never overlaps itself). It claims due rows by setting `next_poll_at = now() + interval` **before** fetching, so a slow poll is never picked twice. | **PROPOSED** |
| 2.11 | Each poll is isolated with try/catch: one bad poll never stops the scheduler or other polls. | **PROPOSED** |
| 2.12 | A newly added competitor is due immediately (`next_poll_at = now()`). | **PROPOSED** |
| 2.13 | Do minor text edits (typo fixes, whitespace) count as a change that matters? | **OPEN** |
| 2.14 | Is a `not_found` right after the first add (never seen `ok`) shown as "unknown id" or as "delisted"? | **OPEN** |

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
_To be derived when this epic starts._

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

## Decision log → README
- What counts as a change (2.4–2.6, 2.2) and what was considered instead.
- Rate-limit + 429 strategy (2.7, 2.8); retries and timeouts (2.9).
- How history is stored (2.3) and how it scales (link to Epic 4).
