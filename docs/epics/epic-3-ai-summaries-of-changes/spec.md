# Epic 3 — AI summaries of changes

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide
>
> **Status: done** — implemented and merged 2026-11-26 (PR #4). This spec reflects the final state.

## Goal
**In one line:** when a competitor's listing really changes, explain the change in plain English using an LLM, and never break or lose anything if the LLM misbehaves.

When a snapshot has `changed: true`, produce a short plain-English summary for a product manager and store it on that snapshot. A problem with the LLM never loses a poll result, and the UI always explains why a summary is missing.

**Definition of done:** advance a competitor in the source → its timeline shows a summary. Make the mock LLM fail or slow → the snapshot is still there, with a clear reason instead of a summary. Polls of unchanged listings don't increase the mock's `callCount`.

## Constraints (from the brief)
- Call the LLM only "on a change that matters".
- "A user must never lose a poll result because of a problem with the LLM."
- Decide what the user sees when the LLM is **slow**, **fails**, **returns something unusable**, or **the daily cap is reached**.
- Production: hard cap of **2,000 LLM calls/day** across all competitors.

## Scope
- OpenAI-compatible LLM client with timeout.
- Old → new values for every change, computed at poll time.
- Rule-written summaries for structured changes (price, title, availability); LLM only for wording changes.
- Prompt: the changes, plus the current normalised listing as context.
- Daily cap enforcement.
- A separate summary worker; writing the summary and its status onto the snapshot.
- UI states for every no-summary reason.

## Out of scope
- Fine-tuning: rejected (no budget, off-scope for the assignment, and it can't be done on the mock). Mention in the README.
- Paid API usage during development.

## Decisions
| # | Decision | Status |
|---|---|---|
| 3.1 | **No money spent.** Use the provided mock LLM (`files/mock-llm/mock-llm-server.py`, OpenAI Chat Completions shape). The client is OpenAI-compatible with configurable `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, so Ollama or a real provider is just a config change. | **DECIDED** |
| 3.2 | No fine-tuning. | **DECIDED** |
| 3.3 | The snapshot is saved by Epic 2 **before** any LLM work. The LLM step only updates the summary columns, so a poll is never lost. | **DECIDED** (implemented) |
| 3.4 | The LLM gets the changed fields, then the current **normalised** listing (4 fields) labelled "for context only", never the raw source JSON. Context lets a stronger model read a change against what the product is; it costs tokens, not calls, so the cap is unaffected. Changes are labelled lines (`Old tagline: "…"` / `New tagline: "…"`). Values are quoted and the system prompt says to treat them as data (they come from a third-party site). The changes come first, so the mock's 160-char echo shows them. Tested on Ollama `llama3.2`: an inline `Tagline: "a" → "b"` made it invent the old value or read the change backwards in 4/4 runs; the labelled lines were right 4/4. The system prompt frames the job (competitive intelligence for a product manager), asks for *what changed + what it likely signals* in ≤ 2 sentences, forbids invented values, and says a typo fix is "a minor rewording". Two worked examples (a strategic move, a typo fix) follow as chat turns: with them llama3.2 went from run-on, partly wrong answers to clean, correct ones, and ignored an injected instruction. **Revised 2026-11-27, holistic summaries:** with several changes llama3.2 summarised only the most striking one (usually the price) and dropped the rest: 0/10 answers covered all three fields of a tagline + price + description change. The prompt now (a) opens with `Changed fields (n): …`, (b) states the price change in words (`New price: "$39/mo" (up 34%)`; a bare `+34%` let it call a rise "lower-priced"), (c) spells out a sentence that was only appended or removed (`Removed from description: "…"`; a full word diff misled it on rewrites, so rewrites get none), (d) asks for every field in sentence 1 and one combined read in sentence 2 (≤ 400 chars), with a three-field worked example built by the same code as the real request, and (e) ends with a reminder `Cover all n changes (…)` when there are two or more. Result on 5 real changes × 5 runs: 25/25 answers cover every changed field (was 15/25). Known limit of a 3B model: the strategic read can still be shaky when signals conflict (price up + features removed). | **DECIDED** (implemented, revised 2026-11-27) |
| 3.5 | The daily cap is counted in the database (`llm_usage`, one row per UTC day) and claimed atomically before each call (`INSERT … ON CONFLICT DO UPDATE … WHERE calls < cap`). Every HTTP call counts, including failed ones. | **DECIDED** (implemented) |
| 3.6 | **Rules for structured changes, LLM for wording.** Every change shows its old → new values (`snapshots.changes`). When only price, title or availability changed, our code writes the summary at poll time (`summaries/rule-summary.ts`, e.g. "Price dropped from $39/mo to $29/mo (-26%).", `summary_source = rule`): no LLM call, no cap used, no risk of a wrong number. Only tagline/description changes (alone or mixed with others) go to the LLM (`summary_source = llm`). First proposed as "hybrid: diff + LLM for every change"; changed on review, see `docs/pushbacks.md` #7. | **DECIDED** 2026-11-26 (revised) |
| 3.7 | **Separate worker.** A poll stores a change as `pending` with `summary_next_attempt_at = now`. A second scheduler (same claim/`SKIP LOCKED` pattern, 4 in flight, newest change first, 120 s lease) summarises due snapshots. A slow LLM never delays polling, and pending work survives restarts. | **DECIDED** 2026-11-26 |
| 3.8 | **Usable** = non-empty after collapsing whitespace, `finish_reason` is `stop` (or absent), ≤ 600 characters, not JSON or a code block. A 200 that isn't a chat completion is also `unusable_output`. | **DECIDED** 2026-11-26 |
| 3.9 | Timeout / LLM error → retried after 1, 5 and 15 min (4 attempts in all), then final. Cap reached → `daily_cap_reached`, no call made, retried after the next UTC midnight (newest first). Unusable → final, not retried. | **DECIDED** 2026-11-26 |

## Summary statuses the UI explains
`summarized` (named so instead of `ok`, to avoid confusion with the snapshot status `ok`) · `pending` · `llm_timeout` · `llm_failed` · `unusable_output` · `daily_cap_reached`, plus the Epic 2 ones: `first_snapshot`, `not_changed`, `fetch_failed`, `not_found`, `incomplete_listing`.

`summary_source` says who wrote a `summarized` summary: `rule` (our code; UI label **Summary**, green) or `llm` (UI label **AI summary**, blue).

| Status | UI text (on a change card, below the old → new values) |
|---|---|
| `summarized` | the summary |
| `pending` | spinner "Writing an AI summary…" (timeline refreshes every 1 s while any is pending) |
| `llm_timeout` | "The AI didn't answer in time. Trying again at <time>." / "Gave up after N attempts." |
| `llm_failed` | "The AI service failed (<error>). Trying again at <time>." / "Gave up after N attempts." |
| `unusable_output` | "The AI's answer couldn't be used (<reason>), so it isn't shown." |
| `daily_cap_reached` | "Today's limit of AI summaries is used up. It will be written after the limit resets at midnight UTC (<local time>)." |

## Failure modes
| Situation | Result |
|---|---|
| Only price / title / availability changed | snapshot kept, `summarized` by rule at poll time, no LLM call |
| LLM slow beyond the timeout | snapshot kept, `llm_timeout`, retried 1 / 5 / 15 min |
| LLM 5xx or network error | snapshot kept, `llm_failed` with the provider's message, retried 1 / 5 / 15 min |
| Unusable response | snapshot kept, `unusable_output` with the reason, not retried |
| Daily cap reached | snapshot kept, `daily_cap_reached`, no call, retried after midnight UTC |
| Worker crashes mid-call | the 120 s lease expires and the snapshot is picked up again |

In every case the card still shows the old → new values, so the user always sees what changed.

## Stories
_Implemented 2026-11-26 on `epic-3-summaries` (PR #4, squash-merged)._

1. **Schema** (`api/drizzle/0003_summaries.sql`): `snapshots` gets `changes jsonb`, `summary_attempts`, `summary_next_attempt_at` (partial index where not null, the worker's queue), `summary_error`; new summary statuses; new table `llm_usage(day, calls)`. Existing `pending` rows are queued by the migration.
2. **Old → new at poll time** (`listings/field-changes.ts`, pure): the changed fields become `{field, before, after}` display pairs, `availability` = listed ↔ not listed. `SnapshotService.recordPoll` stores them, then writes a rule summary (story 9) or queues the change for the LLM.
3. **Prompt + usability check** (`summaries/prompt.ts`, `summaries/summary-check.ts`, pure). Final prompt (story 10): system prompt + two worked examples + this change and the current listing.
4. **LLM client** (`clients/llm/llm-client.ts`; was `summaries/llm-client.ts`, moved with the clients refactor. It also owns the `ChatMessage` type, so `summaries/` depends on the client, not the other way round): any OpenAI-compatible endpoint, one request, `LLM_TIMEOUT_MS` (10 s), returns `answer | timeout | failed | malformed`; only a shutdown abort throws.
5. **Cap** (`summaries/repository.ts`): `incrementCallsIfBelow(cap)`, one atomic statement.
6. **Summary service + worker** (`summaries/service.ts`, wired in `main.ts`): claim → cap → call → store summary or retry plan. The scheduler is now generic (`runJob`) and runs both polls and summaries.
7. **API**: snapshots add `changes`, `summarySource`, `summaryError`, `summaryAttempts`, `summaryRetryAt`.
8. **UI** (`timeline/ChangeSummary.tsx`): every change shows its old → new values, then the AI summary, a "Writing an AI summary…" spinner, or a "No AI summary" box saying why and when it will be retried. The timeline refreshes every second while a summary is pending.
9. **Rule summaries** (`summaries/rule-summary.ts`, pure; migration `0004_summary_source.sql`): price (direction + %, free ↔ paid, incomparable prices stated), title, delisted/back. Written by `recordPoll`, never queued. The UI labels them "Summary" (green) vs "AI summary" (blue). Added on review: see 3.6 and `docs/pushbacks.md` #7.
10. **Prompt iterations, tested on a real model** (Ollama `llama3.2`), see 3.4:
    - labelled `Old …:` / `New …:` lines instead of an inline `a → b` (fixed invented and reversed values);
    - a system prompt framing the job as competitive intelligence for a product manager (what changed + what it likely signals), with two worked examples as chat turns (fixed run-on answers; an injected instruction was treated as data);
    - the current normalised listing added after the changes as context (requested on review: the model needs the product's full picture to judge a change).
    - holistic summaries for several changes (requested on review 2026-11-27: a tagline + price + description change was summarised as the price only): field count header, price direction in words, appended/removed sentences spelled out, a three-field example, a closing coverage reminder. 0/10 → 10/10 on three-field changes, see 3.4.
11. **Readable LLM errors**: an OpenAI-style error body is stored as its message (`HTTP 500: mock-llm-server: injected failure`), not raw JSON.
12. **Local real-model option (Ollama)**: no code, config only. `brew install ollama && ollama serve && ollama pull llama3.2`, then in `api/.env`: `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=llama3.2`, `LLM_API_KEY=ollama`. Compose and the committed defaults stay on the mock.

**Tests:** rule summaries, prompt, usability check, field changes (unit); LLM client against a fake server (ok, 500, timeout, malformed, cut off, unreachable, abort); summaries integration on Postgres (queueing, newest first, lease, retries 1/5/15 min then give up, failure then success, unusable, cap reached, cap under 10 concurrent claims, cap 0, competitor removed, no double summary, API fields).

## Verification (mock LLM control endpoints, `localhost:4001`)
```bash
curl localhost:4001/control/stats                                   # callCount
curl -X POST localhost:4001/control/configure -d '{"failNext":2}'   # failures → snapshot kept, reason shown
curl -X POST localhost:4001/control/configure -d '{"latencyMs":20000}' # timeout fires; API + polling stay responsive
curl -X POST localhost:4001/control/reset
```
- Unchanged polls → `callCount` doesn't grow.
- With `LLM_DAILY_CAP=1` → the second change shows `daily_cap_reached`.

**Results (2026-11-26, local, provided source + mock LLM, poll interval 2 s):**
_First run, before 3.6 was revised and before the prompt iterations (a price change still went to the LLM, prompt format `Price: "a" → "b"`):_
- 8 s of unchanged polls → mock `callCount` 0. `advance acme-crm` → one call, `summarized`.
- `failNext: 1` → `llm_failed` with `HTTP 500: … injected failure`, retry 1 min later; retry made due → `summarized`.
- `latencyMs: 20000` → `pending` while waiting; meanwhile polls kept landing every 2 s and `GET /api/competitors` answered in 4 ms; after 10 s → `llm_timeout`, retry scheduled.
- `LLM_DAILY_CAP=1` → the second change: `daily_cap_reached`, no call (`callCount` stayed 1), retry at next UTC midnight.
_Final state:_
- With a real model (Ollama `llama3.2`, config change only: `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=llama3.2`): tagline changes got accurate summaries in < 1 s (about 3 s on the first call while the model loads), e.g. "Acme CRM has updated its tagline from "Simple CRM for small teams" to "The CRM small teams love", suggesting a shift from emphasizing ease of use to highlighting user love and satisfaction."
- **Browser run of every LLM requirement** (2026-11-26, headless Chrome, poll interval 2 s):
  - Real model (Ollama): price, delisting and relisting got rule summaries with no call; tagline and tagline + description changes got correct AI summaries.
  - Mock: unchanged polls → 21 snapshots in 10 s, `callCount` 0.
  - `failNext` → "The AI service failed (HTTP 500: mock-llm-server: injected failure). Trying again at …", and the scheduled retry 1 min later succeeded (attempt 2).
  - `latencyMs: 15000` → "Writing an AI summary…" while polls kept landing and the API answered in 3 ms; after 10 s "The AI didn't answer in time. Trying again at …"; the retry succeeded.
  - Fake LLM answering JSON → "The AI's answer couldn't be used (answer was not plain text)", not retried.
  - Cap set to today's usage → "Today's limit of AI summaries is used up… resets at midnight UTC", no call made.
  - Every change stayed in the timeline in every case.
- After 3.6 was revised: `advance acme-crm` ($39 → $29) → "Price dropped from $39/mo to $29/mo (-26%).", `callCount` 0; the next version (tagline) → 1 call, AI summary.

## Decision log → README
- Which LLM was used (the mock), how to configure a real one, and Ollama as a free local option (story 12).
- **Rule vs AI summaries (3.6)**, with the two-step check for graders: advance `acme-crm` once (price) → green "Summary", mock `callCount` stays 0; advance again (tagline) → blue "AI summary", `callCount` 1. Otherwise a grader may think the LLM isn't wired after the first change.
- Why the mock's summaries look like echoes (it repeats the first 160 chars of the prompt; changes are put first so the echo shows them).
- Cap strategy (3.5), separate worker (3.7), usability rules (3.8), retries (3.9), failure UX (status table above).
- Prompt design (3.4): changes + normalised listing as context, never the raw response; what testing on a real model changed.
- Fine-tuning considered and rejected.
- Where I pushed back on the AI: `docs/pushbacks.md` #7 (LLM for every change → rules for structured changes).
