# How I worked: spec-driven development with AI

I used Claude Code as a pair programmer. It works best as a fast implementer of decisions I've already made, not as the one making them. So I wrote the decisions down first, and the code came after.

## 1. Understand the brief first
Before any code, I pulled out of the brief what it requires, what it leaves open on purpose, and what it scores. Each epic spec starts from those constraints, quoted word for word. Epic 3, for example, opens with *"on a change that matters"*, *"never lose a poll result"*, the four LLM failure cases and the 2,000/day cap.

Why: the brief leaves decisions open deliberately. If I don't decide them up front, the AI quietly decides them for me.

## 2. Split the work into epics, in order
| Epic | What | Why here |
|---|---|---|
| 0 | Project setup, Docker, DB + migrations | Everything after is built and tested inside the real setup |
| 1 | Add / list / remove competitors | Nothing to poll without it |
| 2 | Polling, rate limit, history, change detection | Summaries need history |
| 3 | AI summaries, cap, failure states | Builds on detected changes |
| 4 | README, production analysis, final Docker check | Collects the decisions from 0–3 |

Each epic was finished, verified and merged before the next one started.

## 3. A spec per epic, before implementing it
Every spec in [`docs/epics/`](epics) has the same structure:
- **Goal**, with a one-line definition of done.
- **Scope** and **out of scope**. Writing down what *not* to build kept the AI from expanding the work.
- **Data model and API**.
- **Decisions**, each marked **DECIDED / PROPOSED / OPEN**. The AI could propose; only I confirmed. Alternatives are written next to each decision.
- **Failure modes**: what the user sees when the source is slow, partial or gone, or the LLM fails. These became the UI states and the test cases.
- **Stories**: the epic broken into tasks.
- **Verification**: how to prove it works, down to the `curl` commands against the source and mock LLM control endpoints.
- **Decision log → README**: what the README needs to say. That's how the README's decisions section was collected as I went.

## 4. One session per epic, one branch, one reviewed PR
Each epic was implemented by its own AI session working from the spec, on its own branch, and merged through a pull request I reviewed (#1–#4). The spec is the hand-off: a new session doesn't need the earlier conversation, because everything decided is written down. Each session gets a small, clear job, and a mistake stays inside one branch.

## 5. Review, then refactor separately
Reviewing the PRs is where I changed what the AI proposed. Business logic had ended up in the persistence layer. Every change, including a plain price change, was sent to the LLM. The retry loop was hard to read. The fixes went in as their own PRs (#5, #7, #8), so the review history shows them.

## 6. Keep the specs true
When an epic was done, I updated its spec to describe what was actually built ("Status: done"). The Docker check deferred from Epics 1–3 is recorded in Epic 4, along with the two bugs it found. The docs describe what exists, not just the original plan.

## Why work this way
- **Judgment is visible.** Every decision and its alternatives are written down before the code.
- **The AI stays under control.** Scope limits, decision statuses and PR reviews make it implement my decisions instead of inventing its own.
- **"Done" means proven.** Every epic has explicit verification steps.
- **It's how a team works anyway:** small reviewed increments, written decisions, and a plan that changes when reality does.
