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

## Production context (from the brief)
- 6,000 tracked competitors, each polled every 15 min
- The source allows at most 5 req/s in total
- 2,000 LLM calls/day hard cap
- History (incl. no-change and failed polls) kept ≥ 90 days

## The analysis (draft, to be finalised)
| Constraint | Maths | Conflict | Direction |
|---|---|---|---|
| Polling rate | 6,000 × 4/h = 24,000/h ≈ **6.67 req/s** | > 5 req/s before any retries | At 5 req/s a full cycle is ≥ 1,200 s ≈ **20 min**. Options: negotiate a higher limit (~7–8 req/s with retry headroom), adaptive intervals (poll rarely-changing competitors less often), or accept ~20 min. Never exceed the limit. |
| LLM cap | 2,000/day ÷ 6,000 competitors ≈ 0.33 summaries per competitor per day | Changes can exceed the cap | Only call on meaningful changes. Possibly deterministic summaries for structured fields (see Epic 3, decision 3.6). Prioritise. |
| Storage | 6,000 × 96 polls/day × 90 days ≈ **52M rows** | A large single table | Lean rows, monthly partitions on `fetched_at`, drop partitions > 90 days. Possibly store listing content only on change. |

## Decisions
| # | Decision | Status |
|---|---|---|
| 4.1 | The README is its own epic, assembled from each epic's decision log. | **DECIDED** |
| 4.2 | Production-scale measures are **described, not built** (partitioning, adaptive polling, multi-worker). | **PROPOSED** |
| 4.3 | Cloud deployment (bonus): only if time remains. | **OPEN** |

## Stories
_To be derived when this epic starts._

## Verification
- A fresh clone + following the README only → the system runs.
- Every checkbox above is ticked.
