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
Needs Node ≥ 24 (npm ≥ 11.19; see `.nvmrc`), Python 3 and a local PostgreSQL.
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
| `SNAPSHOT_RETENTION_DAYS` | `90` | Uneventful polls older than this are purged; changes are kept (see below) |
| `SCHEDULER_ENABLED` | `true` | `false` runs the API without background work (polling, summaries, retention) |

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
- **Retention: keep the changes, expire the noise.** An hourly job (also run at startup) deletes *uneventful* snapshots (no change, incomplete, failed, still not listed) older than `SNAPSHOT_RETENTION_DAYS` (90), in batches of 5,000. Changes and each competitor's first snapshot are kept for good: they're a tiny fraction of the rows and the history a product manager comes back for ("when did they drop their price?"). Each competitor's **latest complete listing is never deleted, however old**, because the next poll is compared with it. Otherwise a competitor delisted for 100 days would come back as a "first snapshot" instead of "back on the source, price dropped". *Considered:* deleting everything older than 90 days (loses the change history and can break change detection), and keeping everything (unbounded growth).

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
The cap is defended by a funnel, not by one trick. Each layer cuts what reaches the next:

| Layer | Calls/day left |
|---|---|
| Naive: one LLM call per poll (6,000 × 96) | 576,000 |
| Change detection: only polls where a field that matters really changed. Noise fields, format variants (`$39 / month` vs `USD 39 per month`), partial and failed responses never count. | = real changes/day |
| Rules: price, title and availability changes are written by code | = wording changes/day |
| Cap: claimed atomically in Postgres; overflow is deferred to the next UTC day, newest first, with old → new still shown | ≤ 2,000 |

The rules alone don't make it fit. They only remove the structured share of changes. Change detection does most of the work. The real question is how often listings are *reworded*. **Break-even is one wording change per competitor every 3 days** (2,000 / 6,000). Weekly rewording is ~860 calls/day and fits. Daily rewording is 6,000 and doesn't. Then the cap guarantees spend never goes over, and the steps below decide which summaries come first.

**What happens to the overflow: newest first, not "where it left off".** Once the cap is reached, a change keeps its snapshot, its `changed: true` and its old → new values; only the AI sentence waits. At midnight UTC the waiting changes become due again, and the worker takes the **newest first** across all competitors. A summary loses value as it ages. Oldest first under steady overload would make *every* summary later each day, so nothing is ever current. Newest first keeps fresh changes on time and leaves only the overflow without an AI sentence. Two side effects, fixed by the first two steps below:
- **Starvation:** the oldest overflow is pushed back every night and keeps saying "waiting for a summary" indefinitely.
- **Unfairness:** one competitor rewording 50 times takes 50 of the newest slots, and another competitor's single change misses out.

Next, in this order:
- **Coalesce per competitor:** if one competitor reworded its listing three times, one summary of the net change is cheaper *and* more useful than three. The queue then holds one entry per competitor with new changes. That fixes the unfairness and means each competitor's **latest state** gets the summary. It stays one competitor per prompt and plain-text output, so the current design holds.
- **Expire stale ones:** a change still unsummarised after a few days (say 3) gets a final "not summarised: too old" status and stops retrying. It keeps its old → new values, so nothing is hidden.
- **Prioritise** the budget by competitor importance or size of change, and say so in the UI.
- **Batch several competitors per call, but only under cap pressure.** The cap counts calls, not tokens, so one call that summarises 10 changes stretches 2,000 calls to ~20,000 summaries. A per-call cap is unusual, though: providers bill by tokens, so Finance most likely means "keep the cost down", and batching keeps the letter of the cap rather than its intent. **I'd confirm with Finance whether they mean calls or cost before relying on it.** When pending changes exceed today's remaining budget, the worker would claim 5–10 changes, send them in one prompt with ids, and ask for `[{"id": 1, "summary": "…"}, …]`. Below that pressure it keeps today's single calls.

  **Why it isn't the default (and isn't built):**
  - It needs structured output: models sometimes return broken JSON, skip an item or mix up ids, so every item needs validating, with missing ones re-queued as single calls.
  - One failure hits the whole batch: a timeout delays all ten summaries.
  - **Cross-talk:** with ten competitors in one prompt, a model can blend details between them, the kind of wrong fact the rule summaries exist to avoid.
  - **It can't be shown with the provided mock**, which only echoes the first 160 characters of the prompt and could never return a per-item answer, so every batch would come back unusable.

**3. History: ~52 million rows.**
6,000 × 96 polls/day × 90 days = **51.8M rows**. Most are "no change" rows carrying a full copy of the listing text: tens of GB with indexes.
- **Built: retention.** Uneventful rows older than 90 days are purged hourly in batches, using a partial index on exactly those rows, so the table stays at about 90 days of polls plus the changes, instead of growing forever.
- **Next: partition `snapshots` by month** on `fetched_at`. At this volume, batched `DELETE`s mean steady vacuum work; with partitions the uneventful history of a whole month goes with one instant `DROP`. Changes would be copied to a small `snapshot_changes` table first, so dropping a partition never loses them.
- **Next: store content only when it changes.** No-change rows would keep the status and time only (or one `first_at / last_at / count` row per run, which is how the UI already shows them).
- Reads are already bounded: the timeline is paginated, and the list reads one row per competitor.

**4. Running more than one instance.**
Claiming is already safe across instances (`SKIP LOCKED`), and so is the LLM cap. The **rate limiter is per process**, though: two API replicas would send 8 req/s. Fix: run polling in one dedicated worker (`SCHEDULER_ENABLED=false` on the API replicas), or share the token bucket (Postgres or Redis).

---

## How I'd use the LLM with production data: competitor trends
I built per-change summaries because the brief asks for them, and kept the LLM to wording changes so the cap goes where interpretation helps. Running it on Ollama showed something else, though: **the AI mostly restates a change a human can read in the old → new diff** ("added payroll exports to its description…"). These fixtures are short one-liners; on real listings, a rewritten paragraph is harder to read by eye, so this has to be checked against real data and real users.

**If production confirms it, I'd change how the budget is spent:**
- **Mark the changes with plain code:** a highlighted old → new diff per field and the code-written summaries that already exist. No LLM, no cap.
- **Spend the LLM, with a bigger model, on what it's actually good at:** a **trend summary per competitor**. A per-change summary answers *"what changed?"*. A product manager's real question is *"where is this competitor heading?"*. One change says little. Ten changes over two months show a pattern, and spotting one in text is what an LLM is good at. Trends run on demand, so a pricier model per call still means far fewer calls.

Until real data says otherwise, the trend summary would come **on top of** the per-change summaries, not instead of them.

**Design:**
- **Input: the list of changes, not raw snapshots.** Retention keeps every change and first snapshot for good, so the history is always there. The input is each change's date and old → new values, plus the starting listing. It's small, cheap and has no noise.
- **On demand and stored:** a "What's the trend?" button calls `GET /api/competitors/:id/trend`. The result is stored and reused until the competitor's next change. Competitors nobody opens cost nothing. It goes through the same daily cap, with a small share reserved for trends.
- **A bigger model for this job only:** `LLM_TREND_MODEL` (e.g. `qwen2.5:7b`). The quick per-change summary can stay on a small, fast model. Spotting a trend needs reasoning, and an on-demand wait of tens of seconds is acceptable.

**Tried on Ollama `llama3.2` (3B)** with `orbit-hr`'s four changes (€8 → €10/seat/mo, → €96/yr, → free for teams under 10, tagline "HR for teams of 10 to 500" → "HR for growing teams"). The overall reading was right: a free tier for small teams and "growing teams" positioning. Two details were wrong:
- It called €96/yr "a more premium pricing strategy". That's €8/mo, so it's cheaper.
- It cited change [1] for the tagline change, which was change [4].

So before building it:
1. **Do the maths in code before the prompt:** send `€10/seat/mo → €96/yr (≈ €8/mo, −20%)`, never raw prices.
2. **Check citations in code:** every claim cites a change number. An answer citing a change that doesn't exist, or the wrong field, is rejected as unusable, like a bad per-change summary today.
3. **Label it in the UI** as an AI interpretation, with links to the changes it cites.

Not built: it goes beyond the brief (summaries between *consecutive* snapshots), and the provided mock only echoes the prompt, so a reviewer couldn't see it work.

---

## Left out on purpose
- **Auth:** the brief assumes one internal user.
- **The scaling measures above** (tiers, partitioning, shared limiter, coalescing, expiring stale summaries, batching): described, not built. Retention *is* built.
- **Cloud deployment** (bonus): skipped to keep the time reasonable.
- **Fine-tuning a model:** no budget, not possible on the mock, and the problem is prompting, not model knowledge.
- **Competitor trend summaries:** designed and tried on Ollama, not built (see above).
- **Notifications** (email/Slack on change) and **soft delete**.
- **Browser e2e tests in the repo:** the UI was verified manually in Chrome; automated tests cover the API, the domain logic and the UI's grouping logic (152 API + 4 web tests).

## AI tools
I built this with **Claude Code** (Anthropic), used as a pair programmer. Each part was planned as an epic spec ([`docs/epics/`](docs/epics)) and built on its own branch with a pull request that I reviewed before merging.

**Where I changed what the AI proposed:**
- **Layering.** The first version put business logic in the persistence layer: change detection ran inside the snapshot repository, and routes held rules like "duplicate → 409". I had it restructured into routes → services → repositories. The service owns the transaction and calls a pure change-detection function, and domain errors map to HTTP in one place.
- **LLM for every change.** The AI sent every change to the LLM, including a plain price change. I asked why a price change needs an LLM call at all. Now price, title and availability changes are summarised by our own code, and the 2,000/day cap is spent only on wording changes that need interpretation.
- **Readability.** I had the source client's retry loop rewritten into a pure response classifier plus an explicit retry policy, comments cut back to Javadoc-style docs, and methods renamed so each layer has its own vocabulary (`competitorService.startTracking` vs `competitorRepository.insert`).
- **The prompt.** I asked for a system prompt that explains the goal (competitive intelligence for a product manager) and for the current listing to be sent as context, so the model understands the product and not just the changed field.
