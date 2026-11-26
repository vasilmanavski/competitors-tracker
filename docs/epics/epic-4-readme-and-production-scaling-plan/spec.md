# Epic 4 — README & production scaling plan

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide
>
> **Status: README written (2026-11-26, branch `epic-4-readme`). Remaining: the final Docker check below, run by me on the personal laptop.**

## Goal
**In one line:** document how to run the system, why it's built this way, and how it would handle the real production numbers.

A README that meets every deliverable in the brief and answers "these numbers do not all fit together; tell us what you would do about that".

**Definition of done:** a reviewer can run the system from the README alone, swap the source and LLM via env vars, and find every required section below.

## Required README sections (from the brief)
- [x] How to run locally (`docker compose up`)
- [x] Which LLM option was used and how to configure it
- [x] How to point at a different data-source URL
- [x] Main decisions + what was considered instead (collected from each epic's "Decision log → README")
- [x] What was left out on purpose
- [x] Which AI tools were used, and **one place where I changed what the AI proposed**
- [x] The production-numbers analysis (below)

## README items collected from earlier epics
- [x] **Rule vs AI summaries** (Epic 3, 3.6) with the two-step check: advance `acme-crm` once (price) → green "Summary", mock `callCount` 0; advance again (tagline) → blue "AI summary", `callCount` 1.
- [x] Why mock summaries look like echoes; how to run a real local model with **Ollama** (Epic 3, story 12).
- [x] Prompt design and what testing on a real model changed (Epic 3, 3.4): labelled old/new lines, competitive-intelligence system prompt + examples, listing as context.
- [x] **Changing `POLL_INTERVAL_SECONDS`** takes effect from each competitor's next poll; to apply it at once, `update competitors set next_poll_at = now()` (Epic 2, 2.15).
- [x] "Where I changed what the AI proposed": the README has a short version (layering, LLM for every change, readability, the prompt). `docs/pushbacks.md` stays uncommitted: it's interview prep, not a deliverable.
- [x] Every poll is stored; the timeline groups unchanged polls for readability (Epic 2, story 14).

## Production context (from the brief)
- 6,000 tracked competitors, each polled every 15 min
- The source allows at most 5 req/s in total
- 2,000 LLM calls/day hard cap
- History (incl. no-change and failed polls) kept ≥ 90 days

## The analysis (final version is in the README, "The production numbers don't fit")
| Constraint | Maths | Conflict | Direction |
|---|---|---|---|
| Polling rate | 6,000 × 4/h = 24,000/h ≈ **6.67 req/s** | > 5 req/s before any retries | Today: the interval stretches gracefully (25 min at our 4 req/s), the limit is never exceeded. Next: tiered intervals by volatility (e.g. 1,000 active at 15 min + 5,000 quiet at 60 min ≈ 2.5 req/s), ask for a higher limit or a batch endpoint, new competitors first (4.4). |
| LLM cap | 2,000/day ÷ 6,000 competitors ≈ 0.33 summaries per competitor per day | Changes can exceed the cap | **Built:** the LLM runs only on meaningful changes, and price / title / availability changes are summarised by rules with no call (Epic 3, 3.6). Over the cap: `daily_cap_reached`, retried after midnight UTC, newest first; the old → new values are always shown. To describe (in this order): coalesce per competitor (one summary of the day's net wording change), prioritise the budget, and **batch only under cap pressure** (5–10 changes per call with a JSON `[{id, summary}]` answer, per-item validation and single-call fallback). Batching isn't the default: it needs structured output, one failure hits the whole batch, competitors can bleed into each other's summaries, and the mock can't return per-item answers. |
| Storage | 6,000 × 96 polls/day × 90 days ≈ **52M rows** | A large single table | **Built:** retention (4.5). Next: monthly partitions on `fetched_at` (changes copied out first), store listing content only on change. |
| Multiple instances | — | The rate limiter is per process | Claims and the LLM cap are already instance-safe. Run polling in one worker (`SCHEDULER_ENABLED=false` on API replicas) or share the token bucket. |

## Decisions
| # | Decision | Status |
|---|---|---|
| 4.1 | The README is its own epic, assembled from each epic's decision log. | **DECIDED** |
| 4.2 | Production-scale measures are **described, not built** (partitioning, tiered polling, shared limiter, coalescing/batching LLM calls). | **DECIDED** 2026-11-26 |
| 4.3 | Cloud deployment (bonus): **skipped**, to keep the time reasonable. Listed under "left out on purpose". | **DECIDED** 2026-11-26 |
| 4.4 | New competitors queue behind overdue ones when polling falls behind (`docs/pushbacks.md` #5). Fix proposed: give new rows priority (e.g. a `next_poll_at` default in the past). **Described in the README, not built** (wrap-up: keep the time reasonable). | **DECIDED** 2026-11-26 |
| 4.5 | **Retention: keep the changes, expire the noise** (option 3 of three discussed). Uneventful snapshots (not `changed`, not `first_snapshot`) older than `SNAPSHOT_RETENTION_DAYS` (default 90) are purged by an hourly job (also at startup), 5,000 rows per statement. Kept for good: changes, first snapshots, and each competitor's **latest complete (`ok`) listing however old**, because it's the change-detection baseline (otherwise a competitor delisted > 90 days returns as a "first snapshot"). Rejected: delete everything > 90 days (loses change history, can break detection); keep everything (unbounded). Partitioning is described, not built. | **DECIDED** 2026-11-26 |

## Final Docker check (deferred from Epics 1–3)
Epics 1–4 are verified locally only (dev laptop has no Docker). **Status: still to do.** Epic 4 was merged before this check (decided 2026-11-26); run it on the personal laptop before submitting:
- [ ] `docker compose up --build` on a fresh clone → all 5 services healthy
- [ ] The API container applies every migration (`0000_init` … latest) on startup
- [ ] Web on `:8080`: add / list / remove a competitor through nginx (POST and DELETE proxied, not just GET)
- [ ] The scheduler in the container reaches `listing-source` by its service hostname (Epic 2)
- [ ] The summary worker reaches `mock-llm` by its service hostname (Epic 3); `LLM_TIMEOUT_MS` passed through
- [ ] Migrations `0003_summaries`, `0004_summary_source` and `0005_retention` apply cleanly in the container; the API logs "retention started"
- [ ] Postgres 17 (compose) vs 14 (local): migrations and queries behave the same
- [ ] Each epic's curl verification passes against the compose stack

## Stories
1. **README** (`README.md`): run with Docker / without Docker, configuration table, other source URL, LLM options (mock used; OpenAI; Ollama), what the UI shows and how to check it (rule vs AI two-step `callCount` check, failure-injection table), main decisions with alternatives, the production-numbers analysis (polling, LLM cap, storage, multiple instances), left out on purpose, AI tools and where I changed what the AI proposed.
2. **Static Docker review** (no Docker on the dev laptop): the API image runs `node src/main.ts` on `node:22-alpine` (≥ 22.18, type stripping) and copies `drizzle/`; compose passes every config var including `LLM_TIMEOUT_MS`; the web image type-checks and builds. Nothing found to fix. The real check is below.
3. **Retention** (4.5): `snapshotRepository.deleteUneventfulBefore(cutoff, limit)` (one `DELETE … WHERE id IN (SELECT … LIMIT n)` that skips changes, first snapshots and each competitor's latest `ok`), `retention/service.ts` (`purgeExpiredSnapshots`: batches until done, abortable), a third job on the generic scheduler in `main.ts` (one at a time, at startup then hourly), config `SNAPSHOT_RETENTION_DAYS`, migration `0005_retention.sql` (partial index on `fetched_at` for uneventful rows; the query plan uses it plus `snapshots_last_ok_idx`). Tests (`retention/retention.test.ts`, real Postgres): mixed history purged correctly; a competitor delisted 150 days keeps its baseline and comes back as "Back on the source… Price dropped"; batching; nothing inside 90 days touched; abort. README: config row, "How history is stored", production section 3.

## Verification
- A fresh clone + following the README only → the system runs.
- The final Docker check above is fully ticked.
- Every checkbox above is ticked.
