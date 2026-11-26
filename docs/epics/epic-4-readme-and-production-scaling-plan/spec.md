# Epic 4 — README & production scaling plan

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide

## Goal
**In one line:** document how to run the system, why it's built this way, and how it would handle the real production numbers.

A README that meets every deliverable in the brief and answers "these numbers do not all fit together; tell us what you would do about that".

**Definition of done:** a reviewer can run the system from the README alone, swap the source and LLM via env vars, and find every required section below.

## Required README sections (from the brief)
- [ ] How to run locally (`docker compose up`)
- [ ] Which LLM option was used and how to configure it
- [ ] How to point at a different data-source URL
- [ ] Main decisions + what was considered instead (collected from each epic's "Decision log → README")
- [ ] What was left out on purpose
- [ ] Which AI tools were used, and **one place where I changed what the AI proposed**
- [ ] The production-numbers analysis (below)

## README items collected from earlier epics
- [ ] **Rule vs AI summaries** (Epic 3, 3.6) with the two-step check: advance `acme-crm` once (price) → green "Summary", mock `callCount` 0; advance again (tagline) → blue "AI summary", `callCount` 1.
- [ ] Why mock summaries look like echoes; how to run a real local model with **Ollama** (Epic 3, story 12).
- [ ] Prompt design and what testing on a real model changed (Epic 3, 3.4): labelled old/new lines, competitive-intelligence system prompt + examples, listing as context.
- [ ] **Changing `POLL_INTERVAL_SECONDS`** takes effect from each competitor's next poll; to apply it at once, `update competitors set next_poll_at = now()` (Epic 2, 2.15).
- [ ] "Where I changed what the AI proposed": from `docs/pushbacks.md` (decide whether to commit that file).
- [ ] Every poll is stored; the timeline groups unchanged polls for readability (Epic 2, story 14).

## Production context (from the brief)
- 6,000 tracked competitors, each polled every 15 min
- The source allows at most 5 req/s in total
- 2,000 LLM calls/day hard cap
- History (incl. no-change and failed polls) kept ≥ 90 days

## The analysis (draft, to be finalised)
| Constraint | Maths | Conflict | Direction |
|---|---|---|---|
| Polling rate | 6,000 × 4/h = 24,000/h ≈ **6.67 req/s** | > 5 req/s before any retries | At 5 req/s a full cycle is ≥ 1,200 s ≈ **20 min**. Options: negotiate a higher limit (~7–8 req/s with retry headroom), adaptive intervals (poll rarely-changing competitors less often), or accept ~20 min. Never exceed the limit. |
| LLM cap | 2,000/day ÷ 6,000 competitors ≈ 0.33 summaries per competitor per day | Changes can exceed the cap | **Built:** the LLM runs only on meaningful changes, and price / title / availability changes are summarised by rules with no call (Epic 3, 3.6). Over the cap: `daily_cap_reached`, retried after midnight UTC, newest first; the old → new values are always shown. To describe: prioritising (e.g. by competitor importance), batching several changes per call. |
| Storage | 6,000 × 96 polls/day × 90 days ≈ **52M rows** | A large single table | Lean rows, monthly partitions on `fetched_at`, drop partitions > 90 days. Possibly store listing content only on change. |

## Decisions
| # | Decision | Status |
|---|---|---|
| 4.1 | The README is its own epic, assembled from each epic's decision log. | **DECIDED** |
| 4.2 | Production-scale measures are **described, not built** (partitioning, adaptive polling, multi-worker). | **PROPOSED** |
| 4.3 | Cloud deployment (bonus): only if time remains. | **OPEN** |
| 4.4 | New competitors queue behind overdue ones when polling falls behind (`docs/pushbacks.md` #5). Fix proposed: give new rows priority (e.g. a `next_poll_at` default in the past). Build it, or describe it in the scaling section? | **OPEN** |

## Final Docker check (deferred from Epics 1–3)
Epics 1–3 are verified locally only (dev laptop has no Docker). Before submitting, on the personal laptop:
- [ ] `docker compose up --build` on a fresh clone → all 5 services healthy
- [ ] The API container applies every migration (`0000_init` … latest) on startup
- [ ] Web on `:8080`: add / list / remove a competitor through nginx (POST and DELETE proxied, not just GET)
- [ ] The scheduler in the container reaches `listing-source` by its service hostname (Epic 2)
- [ ] The summary worker reaches `mock-llm` by its service hostname (Epic 3); `LLM_TIMEOUT_MS` passed through
- [ ] Migrations `0003_summaries` and `0004_summary_source` apply cleanly in the container
- [ ] Postgres 17 (compose) vs 14 (local): migrations and queries behave the same
- [ ] Each epic's curl verification passes against the compose stack

## Stories
_To be derived when this epic starts._

## Verification
- A fresh clone + following the README only → the system runs.
- The final Docker check above is fully ticked.
- Every checkbox above is ticked.
