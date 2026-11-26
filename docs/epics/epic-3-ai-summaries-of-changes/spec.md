# Epic 3 — AI summaries of changes

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide
>
> Low-level design is deliberately postponed until this epic starts. Only direction and constraints are captured here.

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
- Prompt built from the changed fields.
- Daily cap enforcement.
- Writing the summary and the summary status onto the snapshot.
- UI states for every no-summary reason.

## Out of scope
- Fine-tuning: rejected (no budget, off-scope for the assignment, and it can't be done on the mock). Mention in the README.
- Paid API usage during development.

## Decisions
| # | Decision | Status |
|---|---|---|
| 3.1 | **No money spent.** Use the provided mock LLM (`files/mock-llm/mock-llm-server.py`, OpenAI Chat Completions shape). The client is OpenAI-compatible with configurable `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, so Ollama or a real provider is just a config change. | **DECIDED** |
| 3.2 | No fine-tuning. | **DECIDED** |
| 3.3 | The snapshot is saved by Epic 2 **before** any LLM work. The LLM step only updates `summary` / `summary_status`, so a poll is never lost. | **PROPOSED** |
| 3.4 | Only the changed fields (old → new) are sent to the LLM, never the raw source JSON. | **PROPOSED** |
| 3.5 | The daily cap is counted in the database (it survives restarts) and claimed atomically before each call. | **PROPOSED** |
| 3.6 | **Deterministic vs LLM summaries**: e.g. a price change could be summarised without the LLM ("Price: $39/mo → $29/mo"). Options: hybrid fallback / deterministic-first / LLM only. | **OPEN**, decide at epic start |
| 3.7 | The LLM call runs inline after the poll, or in a separate worker that picks up `pending` snapshots (the worker survives crashes and keeps polling fast). | **OPEN** |
| 3.8 | What a "usable" response is (length, plain text, non-empty). Note: the mock echoes its input. | **OPEN** |
| 3.9 | Retry policy for failed / timed-out / cap-reached summaries (retry later? next day? never?). | **OPEN** |

## Summary statuses the UI must explain (draft)
`ok` · `pending` · `llm_timeout` · `llm_failed` · `unusable_output` · `daily_cap_reached`, plus the Epic 2 ones: `first_snapshot`, `not_changed`, `fetch_failed`, `not_found`, `incomplete_listing`.

## Failure modes
| Situation | Result |
|---|---|
| LLM slow beyond the timeout | snapshot kept, `llm_timeout` |
| LLM 5xx | snapshot kept, `llm_failed` |
| Unusable response | snapshot kept, `unusable_output` |
| Daily cap reached | snapshot kept, `daily_cap_reached` (+ fallback text if 3.6 says so) |

## Stories
_To be derived when this epic starts._

## Verification (mock LLM control endpoints, `localhost:4001`)
```bash
curl localhost:4001/control/stats                                   # callCount
curl -X POST localhost:4001/control/configure -d '{"failNext":2}'   # failures → snapshot kept, reason shown
curl -X POST localhost:4001/control/configure -d '{"latencyMs":20000}' # timeout fires; API + polling stay responsive
curl -X POST localhost:4001/control/reset
```
- Unchanged polls → `callCount` doesn't grow.
- With `LLM_DAILY_CAP=1` → the second change shows `daily_cap_reached`.

## Decision log → README
- Which LLM was used (the mock) and how to configure a real one.
- Cap strategy, the deterministic-vs-LLM choice, failure UX.
- Fine-tuning considered and rejected.
