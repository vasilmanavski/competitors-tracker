# CompetitorPulse

Tracks competitor product listings over time, decides when a listing changed in a way that matters to a product manager, and explains the change in plain English.

- **Backend:** Node.js 22 + TypeScript (strict), Fastify, Zod, PostgreSQL with Drizzle migrations.
- **Frontend:** React + Vite (TypeScript), served by nginx in Docker.
- **Background work:** a polling scheduler and an LLM summary worker, both inside the API process.

```
browser ─► web (nginx :8080) ─/api─► api (:3000) ─► postgres
                                       │  ├─ polling scheduler ──► listing source (:4002)
                                       │  └─ summary worker ─────► LLM (mock :4001, or any OpenAI-compatible URL)
```

---

## Run it

### With Docker (one command)
```bash
docker compose up --build
```
Open **http://localhost:8080**. Track `acme-crm`; its first poll lands within about a second.

| Service | Host port | Notes |
|---|---|---|
| web | 8080 | React app; nginx proxies `/api` to the API |
| api | 3000 | `GET /health` |
| listing-source | 4002 | the provided source, unmodified |
| mock-llm | 4001 | the provided mock LLM, unmodified |
| postgres | 5433 | 5433 avoids a clash with a local Postgres |

Migrations run automatically when the API starts.

### Without Docker
Needs Node ≥ 22.18, Python 3 and a local PostgreSQL.
```bash
npm run setup      # installs everything, creates the DB, copies api/.env.example → api/.env
npm run dev:all    # source :4002, mock LLM :4001, API :3000, web :5173
npm test           # API + web tests; run `npm --prefix api run test:db` once to create the test DB
```

### Configuration
Every setting is an env var, validated at startup. For Docker, put overrides in a `.env` next to `docker-compose.yml` (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `SOURCE_BASE_URL` | `http://listing-source:4002` | The listing source |
| `POLL_INTERVAL_SECONDS` | `900` | Poll every competitor every 15 min. A change applies from each competitor's next poll; to apply it at once: `update competitors set next_poll_at = now()` |
| `SOURCE_RATE_LIMIT_PER_SECOND` | `4` | Our pace for **all** source requests (the source allows 5) |
| `SOURCE_TIMEOUT_MS` / `SOURCE_MAX_RETRIES` | `5000` / `2` | Per attempt; retries on 5xx, timeout, network error, non-JSON |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | mock | Any OpenAI Chat Completions endpoint |
| `LLM_DAILY_CAP` | `2000` | Hard cap on LLM calls per UTC day |
| `LLM_TIMEOUT_MS` | `10000` | Per LLM call |
| `SCHEDULER_ENABLED` | `true` | `false` runs the API without polling and summaries |

### Point it at a different listing source
```bash
# .env next to docker-compose.yml
SOURCE_BASE_URL=http://host.docker.internal:5002
```
The backend reaches the source only through this URL and never reads its files.

### Which LLM, and how to use another one
**Used: the provided mock LLM** (no money spent, no key to share). The mock doesn't write real summaries: it echoes the first 160 characters of the prompt, so its "summaries" look like `Mock AI summary (not a real model). Based on what you sent: "Old tagline: …"`. The prompt puts the changes first, so the echo shows what was sent.

The client speaks the OpenAI Chat Completions shape, so any compatible provider is only a config change:
```bash
# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# Ollama, free and local (brew install ollama && ollama serve && ollama pull llama3.2)
LLM_BASE_URL=http://host.docker.internal:11434/v1   # http://localhost:11434/v1 without Docker
LLM_API_KEY=ollama
LLM_MODEL=llama3.2
```
I tested the prompt against Ollama `llama3.2` as well as the mock.

---

## What you'll see, and how to check it

1. **List view:** add / remove competitors. Badges: **changed in last 24 h**, and **never found at source** for ids that have only ever returned 404 (typos are accepted, then flagged).
2. **Timeline view:** newest first. Each change is a card with the listing, the **old → new values**, and a summary, or the reason there is none. Runs of unchanged polls collapse into one divider: `No change · 46 checks · 6:00 AM – 5:15 PM`.

**Rule vs AI summaries.** A price, title or availability change gets a summary **written by our code**, with no LLM call: *"Price dropped from $39/mo to $29/mo (-26%)."* (green **Summary**). Only tagline and description changes, where wording has to be interpreted, go to the LLM (blue **AI summary**). So with the provided fixtures:
```bash
curl -X POST localhost:4002/control/advance -d '{"id":"acme-crm","steps":2}'  # price → rule summary
curl localhost:4001/control/stats                                           # {"callCount": 0}
curl -X POST localhost:4002/control/advance -d '{"id":"acme-crm","steps":1}'  # tagline → AI summary
curl localhost:4001/control/stats                                           # {"callCount": 1}
```

**Failure handling** (each was verified in a browser):

| Try | Expect |
|---|---|
| `curl -X POST localhost:4002/control/configure -d '{"failNext":40}'` | "Fetch failed: HTTP 503 (3 attempts)" cards; the scheduler keeps going |
| `… '{"rateLimitPerSecond":1}'` (source) | 429s are waited out (`Retry-After`); no poll is lost |
| `… '{"partialNext":2}'` (source) | "Incomplete listing", never a false change |
| `curl -X POST localhost:4001/control/configure -d '{"failNext":1}'` | "The AI service failed (HTTP 500: …). Trying again at …", then the retry succeeds |
| `… '{"latencyMs":20000}'` (mock LLM) | "Writing an AI summary…", polling continues, then "The AI didn't answer in time. Trying again at …" |
| `LLM_DAILY_CAP=1`, two wording changes | the second: "Today's limit of AI summaries is used up… resets at midnight UTC" |

---

## Main decisions (and what I considered instead)

Full reasoning per epic: [`docs/epics/`](docs/epics).

**What counts as a change**
- Every response is **normalised** to 4 fields (title, tagline, price, description). Noise fields are dropped; HTML entities and whitespace are cleaned. The price is parsed to `{amount, currency, period}`, so `$39/mo`, `$39.00/mo`, `USD 39 per month` are equal, and `Free` = `$0/mo`. *Considered:* comparing raw text (endless false changes) or hashing the response (noise changes every request).
- **Changed** = a normalised field differs from the **last complete (`ok`) snapshot**. Any remaining text edit counts, typo fixes included: deciding how much it matters is the summary's job. *Considered:* a similarity threshold, which can hide real one-word changes.
- An **incomplete listing** is stored but never compared against and never reported as "field removed". A **failed fetch** is never a change.
- **Delisting and relisting are changes**, based only on a real 404 after the listing had been seen. A 404 for an id never seen means "never found at source", not a change.
- **Unknown ids are accepted.** The source can't tell us in advance, a 404 also means "temporarily delisted", and checking at request time would make `POST` depend on a rate-limited, flaky source. *Considered:* rejecting on 404.

**Rate limit and the scheduler**
- **One global limiter** at 4 req/s, evenly spaced (no bursts). On a 429 it pauses **every** caller for `Retry-After`. *Considered:* per-competitor limits; the source's limit is global, so they don't help.
- Each attempt times out after 5 s; 5xx, timeouts and network errors are retried twice with backoff. After that, a `fetch_failed` snapshot stores each attempt's error. The next scheduled poll is the retry. *Considered:* re-polling failures early, rejected because the rate limit, not failures, is the binding constraint.
- **The database is the queue.** A 1-second tick claims due competitors with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, pushing `next_poll_at` forward *before* fetching. A slow poll is never picked twice, several API instances can share the work, and when polling falls behind the interval stretches instead of a backlog piling up. *Considered:* a job queue (Redis/BullMQ), which is another moving part for no gain at this size, and a DB trigger with `LISTEN/NOTIFY`, which isn't durable and doesn't help with the real bottleneck.

**How history is stored**
- **Every poll is a row** (`snapshots`), including no-change, incomplete, 404 and failed polls, because the brief requires them visible for 90 days. Change detection and the insert run in **one transaction** with the competitor row locked. The list view reads denormalised `last_*` columns on `competitors`, so it never scans snapshots. Deleting a competitor deletes its history. *Considered:* storing only changes (fails the 90-day requirement) and soft delete.

**The LLM and the cap**
- **A poll never waits for the LLM.** The snapshot is committed first; a separate **summary worker** (same `SKIP LOCKED` pattern, newest change first, 120 s lease) does the call. A slow or failing LLM can't lose or delay a poll result.
- **Rules for structured changes, LLM for wording.** Price, title and availability changes are summarised by code at poll time: free, instant, and never a wrong number. *Considered:* calling the LLM for every change, which spends the cap on changes a template states better.
- **Prompt:** the changed fields as `Old …` / `New …` lines, then the current normalised listing as context, never the raw response. The system prompt asks for *what changed and what it likely signals* for a product manager, with two worked examples. Listing text is treated as data. Testing on a real model shaped this: an inline `"a" → "b"` format made llama3.2 invent or reverse values in 4/4 runs, and labelled lines fixed it.
- **Cap:** counted per UTC day in Postgres, claimed atomically before each call (`… ON CONFLICT DO UPDATE … WHERE calls < cap`), so it holds across restarts and instances. Failed calls count too.
- **What the user sees when there's no AI summary:** the old → new values are always shown, plus the reason:

  | Situation | Shown | Then |
  |---|---|---|
  | LLM slow (> 10 s) | "The AI didn't answer in time" | retried after 1, 5, 15 min, then given up |
  | LLM error | "The AI service failed (HTTP 500: …)" | same |
  | Unusable answer (empty, cut off, > 600 chars, JSON) | "The AI's answer couldn't be used (reason)" | not retried |
  | Daily cap reached | "Today's limit of AI summaries is used up" | retried after midnight UTC, newest first |

---

## The production numbers don't fit: what I'd do

The brief: 6,000 competitors every 15 min, a 5 req/s source, 2,000 LLM calls/day, 90 days of history.

**1. Polling needs 6.7 req/s; the source allows 5.**
6,000 × 4 polls/h = 24,000/h = **6.7 req/s**, before any retries. At our 4 req/s a full round takes **25 min**; at the full 5 req/s, 20 min. What the system does today: it degrades gracefully. Every competitor is still polled in turn, the interval just stretches, and the limit is never exceeded. What I'd do next:
- **Tiered intervals by volatility:** competitors that changed recently are polled every 15 min, quiet ones every 60 min (`last_changed_at` is already stored). For example, 1,000 active at 15 min (1.1 req/s) plus 5,000 quiet at 60 min (1.4 req/s) is **2.5 req/s**, with headroom for retries.
- **Ask the source owner** for a higher limit or a batch/changes-since endpoint. One request for many ids beats any scheduling trick.
- **New competitors first:** when behind, a newly added competitor currently queues behind overdue ones. Defaulting its `next_poll_at` to the past is a one-line fix (not built).

**2. 2,000 LLM calls/day can't cover every change.**
If each of 6,000 competitors changes once a week, that's ~860 changes/day and it fits. Once a day each, it's 6,000 and it doesn't. Already built: the LLM only runs on changes that matter, structured changes never use it, and overflow is deferred to the next day with the old → new values still shown. Next:
- **Coalesce:** one summary per competitor per day covering all its wording changes, instead of one per change.
- **Batch:** summarise several competitors' changes in one call (the cap counts calls, not tokens).
- **Prioritise** the budget by competitor importance or size of change, and say so in the UI.

**3. History: ~52 million rows.**
6,000 × 96 polls/day × 90 days = **51.8M rows**. Most are "no change" rows carrying a full copy of the listing text: tens of GB with indexes. What I'd do:
- **Store content only when it changes.** No-change rows keep the status and time only (or a run as a single `first_at / last_at / count` row, which is how the UI already shows them).
- **Partition `snapshots` by month** on `fetched_at` and drop partitions older than 90 days: retention by `DROP`, not slow `DELETE`s.
- Reads are already bounded: the timeline is paginated, and the list reads one row per competitor.

**4. Running more than one instance.**
Claiming is already safe across instances (`SKIP LOCKED`), and so is the LLM cap. The **rate limiter is per process**, though: two API replicas would send 8 req/s. Fix: run polling in one dedicated worker (`SCHEDULER_ENABLED=false` on the API replicas), or share the token bucket (Postgres or Redis).

---

## Left out on purpose
- **Auth:** the brief assumes one internal user.
- **The scaling measures above** (tiers, partitioning, shared limiter, coalescing): described, not built.
- **Cloud deployment** (bonus): skipped to keep the time reasonable.
- **Fine-tuning a model:** no budget, not possible on the mock, and the problem is prompting, not model knowledge.
- **Notifications** (email/Slack on change) and **soft delete**.
- **Browser e2e tests in the repo:** the UI was verified manually in Chrome; automated tests cover the API, the domain logic and the UI's grouping logic (152 API + 4 web tests).

## AI tools
I built this with **Claude Code** (Anthropic), used as a pair programmer. Each part was planned as an epic spec ([`docs/epics/`](docs/epics)) and built on its own branch with a pull request that I reviewed before merging.

**Where I changed what the AI proposed:**
- **Layering.** The first version put business logic in the persistence layer: change detection ran inside the snapshot repository, and routes held rules like "duplicate → 409". I had it restructured into routes → services → repositories. The service owns the transaction and calls a pure change-detection function, and domain errors map to HTTP in one place.
- **LLM for every change.** The AI sent every change to the LLM, including a plain price change. I asked why a price change needs an LLM call at all. Now price, title and availability changes are summarised by our own code, and the 2,000/day cap is spent only on wording changes that need interpretation.
- **Readability.** I had the source client's retry loop rewritten into a pure response classifier plus an explicit retry policy, comments cut back to Javadoc-style docs, and methods renamed so each layer has its own vocabulary (`competitorService.startTracking` vs `competitorRepository.insert`).
- **The prompt.** I asked for a system prompt that explains the goal (competitive intelligence for a product manager) and for the current listing to be sent as context, so the model understands the product and not just the changed field.
