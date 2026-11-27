# CompetitorPulse

Tracks competitor listings over time, decides when a listing changed in a way a product manager would care about, and explains the change in plain English.

**In short**
- `docker compose up --build`, then open http://localhost:8080.
- Every poll is recorded, including unchanged and failed ones. A run of unchanged polls (or of repeated 404s) is one row with a check count, not one row per poll. A change is decided on 4 normalised fields, so format noise never counts.
- Price, title and availability changes are summarised by my own code. The LLM is only used for wording changes, where interpretation actually helps.
- The source rate limit and the 2,000/day LLM cap hold across restarts. When the numbers don't fit, the system slows down instead of breaking.
- [The production numbers don't fit](#the-production-numbers-dont-fit-what-id-do) is where most of my thinking went.

**Stack:** Node.js 24 + TypeScript (strict), Fastify, Zod, PostgreSQL with Drizzle migrations. React + Vite, served by nginx in Docker. Polling, LLM summaries and retention run as background workers inside the API process.

```
browser ─► web (nginx :8080) ─/api─► api (:3000) ─► postgres
                                       │  ├─ polling scheduler ──► listing source (:4002)
                                       │  └─ summary worker ─────► LLM (mock :4001, or any OpenAI-compatible URL)
```

---

## Run it

### With Docker
```bash
docker compose up --build
```
Open **http://localhost:8080** and track `acme-crm`. The first poll lands within a second. Migrations run when the API starts.

| Service | Port | Notes |
|---|---|---|
| web | 8080 | React app; nginx proxies `/api` to the API |
| api | 3000 | `GET /health` |
| listing-source | 4002 | the provided source, unmodified |
| mock-llm | 4001 | the provided mock LLM, unmodified |
| postgres | 5433 | not 5432, so it doesn't clash with a local Postgres |

### Without Docker
Needs Node ≥ 24 (npm ≥ 11.19, see `.nvmrc`), Python 3 and a local PostgreSQL.
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
| `POLL_INTERVAL_SECONDS` | `900` | Poll each competitor every 15 min |
| `SOURCE_RATE_LIMIT_PER_SECOND` | `4` | Pace for **all** source requests (the source allows 5) |
| `SOURCE_TIMEOUT_MS` / `SOURCE_MAX_RETRIES` | `5000` / `2` | Per attempt; retried on 5xx, timeout, network error, non-JSON |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | mock | Any OpenAI Chat Completions endpoint |
| `LLM_DAILY_CAP` | `2000` | Hard cap on LLM calls per UTC day |
| `LLM_TIMEOUT_MS` | `10000` | Per LLM call |
| `SNAPSHOT_RETENTION_DAYS` | `90` | Uneventful snapshots (unchanged, failed, incomplete, still not listed) whose last check is older than this are deleted; changes are kept |
| `SCHEDULER_ENABLED` | `true` | `false` runs the API without background work |

A new poll interval applies from each competitor's next poll. To apply it straight away: `update competitors set next_poll_at = now()`.

### A different listing source
```bash
# .env next to docker-compose.yml
SOURCE_BASE_URL=http://host.docker.internal:5002
```
The backend only talks to the source over this URL. It never reads the source's files.

### Which LLM
I used **the provided mock LLM**: no cost, no key to share. It doesn't write real summaries, it echoes the start of the prompt, so a "summary" looks like `Mock AI summary (not a real model). Based on what you sent: "Changed fields (1): tagline. Old tagline: …"`.

The client speaks the OpenAI Chat Completions format, so switching is just config:
```bash
# OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini

# Ollama (free, local)
LLM_BASE_URL=http://host.docker.internal:11434/v1   # http://localhost:11434/v1 without Docker
LLM_API_KEY=ollama
LLM_MODEL=llama3.2
LLM_TIMEOUT_MS=60000                                # a local model on CPU is slower
```
I also tested against Ollama `llama3.2`; the prompt design came out of those tests.

---

## What you'll see, and how to check it

- **List view:** add and remove competitors. Badges show **changed in the last 24 h**, and **never found at source** for ids that have only ever returned 404. I accept unknown ids and flag them, so a typo is visible rather than rejected.
- **Timeline view:** newest first. Each change is a card with the **old → new values** and the summary, or the reason there isn't one. A run of unchanged polls is one line: `No change · 46 checks · 6:00 AM – 5:15 PM`.

**Code vs AI summaries.** A price, title or availability change gets a summary written by code, with no LLM call (green **Summary**). Tagline and description changes go to the LLM (blue **AI summary**). To check it:
```bash
curl -X POST localhost:4002/control/advance -d '{"id":"acme-crm","steps":2}'  # price → code summary
curl localhost:4001/control/stats                                           # {"callCount": 0}
curl -X POST localhost:4002/control/advance -d '{"id":"acme-crm","steps":1}'  # tagline → AI summary
curl localhost:4001/control/stats                                           # {"callCount": 1}
```

**Failures.** I checked each of these in the browser:

| Try | Expect |
|---|---|
| `curl -X POST localhost:4002/control/configure -d '{"failNext":40}'` | "Fetch failed: HTTP 503 (3 attempts)" cards; polling carries on |
| `… '{"rateLimitPerSecond":1}'` (source) | 429s are waited out (`Retry-After`); no poll is lost |
| `… '{"partialNext":2}'` (source) | "Incomplete listing", never a false change |
| `curl -X POST localhost:4001/control/configure -d '{"failNext":1}'` | "The AI service failed (HTTP 500: …). Trying again at …", then the retry succeeds |
| `… '{"latencyMs":20000}'` (mock LLM) | "Writing an AI summary…", polling continues, then "The AI didn't answer in time. Trying again at …" |
| `LLM_DAILY_CAP=1`, two wording changes | the second shows "Today's limit of AI summaries is used up… resets at midnight UTC" |

---

## Main decisions

The full reasoning is in [`docs/epics/`](docs/epics).

### What counts as a change
- I **normalise every response to 4 fields**: title, tagline, price, description. Noise fields are dropped, HTML entities and whitespace cleaned up. The price is parsed into `{amount, currency, period}`, so `$39/mo`, `$39.00/mo` and `USD 39 per month` are equal, and `Free` equals `$0/mo`. Comparing raw text or hashing the response would flag a change on almost every poll.
- **Changed** means a normalised field differs from the **last complete snapshot**. Any text edit counts, typos included; how much it matters is the summary's job. I didn't use a similarity threshold, because it can hide a real one-word change.
- An **incomplete listing** is stored but never compared against. A **failed fetch** is never a change.
- **Delisting and relisting are changes**, but only once the listing has been seen. A 404 for an id that was never found means "never found at source".
- **Unknown ids are accepted.** The source can't tell me in advance which ids exist, a 404 can mean "temporarily delisted", and checking on `POST` would tie adding a competitor to a flaky, rate-limited source.

### Rate limit and scheduling
- **One global limiter** at 4 req/s, evenly spaced. I stay under the source's 5 because I can't see its counting window. A 429 pauses **every** request for the `Retry-After` time. Per-competitor limits wouldn't help: the source's limit is global.
- Each attempt times out after 5 s. 5xx, timeouts and network errors are retried twice with backoff, then stored as `fetch_failed` with every attempt's error. The next scheduled poll is the retry; re-polling failures early would just eat the rate limit.
- **The database is the queue.** Every second the scheduler claims due competitors with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and moves their `next_poll_at` forward *before* fetching. A slow poll is never picked twice, instances can share the work, and when polling falls behind the interval stretches instead of a backlog building up. Redis/BullMQ would be one more moving part for no gain at this size.

### How history is stored
- **Every poll is recorded** in `snapshots`, including unchanged, incomplete, 404 and failed ones, because the brief wants them visible for 90 days. Change detection and the write run in one transaction with the competitor row locked. The list view reads summary columns on `competitors`, so it never scans snapshots.
- **A quiet run is one row.** An unchanged poll after an unchanged poll, or a 404 after a 404, extends the newest row (`last_checked_at`, `check_count + 1`) instead of inserting one. 30 unchanged polls are one row, which is exactly what the timeline shows. Changes, firsts, failures and incomplete listings are still one row each and end the run. I give up the time of each check inside a run; the count and the first and last check stay. I considered keeping a row per poll without the listing copy, but that's still ~52M rows.
- **Retention keeps the changes and expires the noise.** An hourly job deletes uneventful snapshots whose last check is older than 90 days, in batches of 5,000. Kept for good: changes, first snapshots, each competitor's **latest complete listing** (the next poll is compared with it, so a competitor delisted for 100 days comes back as "back on the source, price dropped", not as a first snapshot), and each competitor's newest row (so a poll after a long outage never extends a run across a failure).

### The LLM and the cap
- **A poll never waits for the LLM.** The snapshot is saved first; a separate worker makes the call (same `SKIP LOCKED` pattern, newest change first, 120 s lease). A slow or failing LLM can't lose or delay a poll.
- **Code for structured changes, LLM for wording.** Price, title and availability changes are summarised by code at poll time: free, instant, and never a wrong number.
- **Prompt:** the changes as labelled `Old …` / `New …` lines, then the current listing as context, never the raw response. The system prompt asks what changed and what it likely signals for a product manager, with two worked examples, and treats listing text as data. Testing on llama3.2 shaped it: an inline `"a" → "b"` format made it invent or reverse values, and with several changes it only covered the most striking one. Listing the changed fields up front and asking for every field took it from 0 to 10 out of 10 on three-field changes.
- **Cap:** counted per UTC day in Postgres and claimed atomically before each call (`… ON CONFLICT DO UPDATE … WHERE calls < cap`), so it holds across restarts and instances. Failed calls count too. So an LLM outage can't spend the day on failures, **a circuit breaker** pauses summaries for 5 minutes after 5 failures in a row, then tries one call.
- **No AI summary?** The old → new values are always shown, plus the reason:

  | Situation | Shown | Then |
  |---|---|---|
  | LLM slow (> 10 s) | "The AI didn't answer in time" | retried after 1, 5, 15 min, then given up |
  | LLM error | "The AI service failed (HTTP 500: …)" | same |
  | Unusable answer (empty, cut off, > 600 chars, JSON) | "The AI's answer couldn't be used (reason)" | not retried |
  | Daily cap reached | "Today's limit of AI summaries is used up" | retried after midnight UTC, newest first |

---

## The production numbers don't fit: what I'd do

The brief: 6,000 competitors every 15 min, a source that allows 5 req/s, 2,000 LLM calls a day, 90 days of history.

### 1. Polling needs 6.7 req/s; the source allows 5
At my 4 req/s, a 15-minute window fits 3,600 polls, so up to 3,600 competitors keep their 15-minute interval. Past that nothing breaks: everyone is still polled in turn, oldest first, and the interval stretches. At 6,000 a full round takes **25 min**. The limit is never exceeded and no backlog builds up.

Next:
- **Poll quiet competitors less often.** No change in 7 days → every 60 min; changed recently or new → every 15 min. A quiet competitor that changes goes straight back to 15 min. It's one `CASE` in `claimDue` on `last_changed_at`, which already exists. With 1,000 active and 5,000 quiet that's **2.5 req/s**, with room for retries. The cost: a change on a quiet competitor is seen up to an hour late, so I'd let users pin important ones, and measure the real share of quiet competitors first.
- **Ask the source owner** for a higher limit or a batch / "changes since" endpoint. One request for many ids beats any scheduling trick.
- **Poll new competitors first.** A new one currently waits behind overdue ones; defaulting its `next_poll_at` to the past is a one-line fix.

### 2. 2,000 LLM calls a day
A poll never calls the LLM. It's called only for wording changes (tagline, description), one call per change, at most 2,000 a day:

| What a poll finds | LLM call? |
|---|---|
| No change (also format noise, a partial listing, a failed fetch, still a 404) | No |
| Price, title or availability change | No: my code writes the summary |
| Tagline or description change | Yes, one call per change |
| Over 2,000 calls today | No: it waits until after midnight UTC, old → new shown meanwhile |

So the daily spend is the number of wording changes, not the number of polls. Spend can't go over 2,000; the question is whether every change still gets a summary. **Break-even is one wording change per competitor every 3 days** (2,000 / 6,000). Weekly rewording is ~860 calls a day and fits; daily rewording is 6,000 and doesn't.

Past the cap I take the **newest first**: a summary loses value as it ages, and oldest-first under steady overload would make every summary a bit later each day. The side effects are that the oldest overflow can wait forever and one competitor rewording 50 times can crowd out others. So next, in order:
- **One summary per competitor:** three rewordings get one summary of the net change.
- **Give up on stale ones** after about 3 days; the old → new values stay.
- **Prioritise** by competitor importance or size of change.
- **Batch competitors per call, only under cap pressure.** It stretches a per-call cap, but providers bill by tokens, so I'd check what Finance actually means first. It also needs structured output, and one timeout delays the whole batch.

### 3. History: 52 million polls, far fewer rows
6,000 × 96 × 90 days = **51.8M polls**, most of them unchanged.
- **Built:** quiet runs. A competitor that doesn't change is one row per stretch between events, not 96 rows a day, so rows grow with changes and failures, not with polls.
- **Built:** retention, with a partial index on the rows it deletes.
- **Next:** monthly partitions, so an expired month is one instant `DROP`. With quiet runs this matters much less.
- Reads are bounded: the timeline is paginated and the list reads one row per competitor.

### 4. More instances don't help throughput
**One instance is the right size.** Every limit that matters is outside the process: the source's 5 req/s (one process already uses 4), the 2,000/day LLM budget, and one internal user. A second poller would only split the same 4 req/s, or exceed it, because the rate limiter lives in each process.

A second instance is only worth it for **availability**. Claiming and the LLM cap are already safe across instances, so that works as long as polling runs in one of them (`SCHEDULER_ENABLED=false` on the other).

---

## Beyond the brief
- **Where I'd really spend the LLM: competitor trends.** Honestly, I don't find the per-change AI summaries that valuable. These are four short fields, and the old → new diff already shows what changed at a glance. That's also why price, title and availability changes get a summary written by plain code. What a person can't see at a glance is the pattern across many changes, so I'd use the LLM for an on-demand trend summary per competitor over the last X weeks ("where is this competitor heading?"). I tried it on llama3.2 and it got the big picture right but two details wrong, so it needs the maths done in code and its citations checked. Not built. Details: [`docs/competitor-trends.md`](docs/competitor-trends.md).
- **Deployment:** I skipped the cloud bonus. For a demo: one 2 GB VM running the same `docker compose up`, a firewall allowing only SSH and port 8080, and Caddy with a free `<ip>.sslip.io` hostname for HTTPS. For production: managed Postgres, one instance that the platform restarts on a failing `/health`, and secrets from the platform. Details: [`docs/deploy.md`](docs/deploy.md).

## Left out on purpose
- **Auth:** the brief assumes one internal user.
- **The scaling steps above** (quiet-competitor intervals, partitioning, shared limiter, one summary per competitor, expiring stale summaries, batching): described, not built. Retention, quiet runs and the LLM circuit breaker are built.
- **Competitor trends** and **cloud deployment**: see above.
- **Fine-tuning:** no budget, not possible on the mock, and the problem is prompting, not model knowledge.
- **Notifications** (email/Slack) and **soft delete**.
- **Browser e2e tests:** I tested the UI by hand in Chrome. Automated tests cover the API, the domain logic and the UI's grouping logic (174 API + 5 web tests).

## How I worked, and AI tools
I built this with **Claude Code** as a pair programmer, spec first: a spec per epic in [`docs/epics/`](docs/epics), one AI session per epic on its own branch, and every change merged through a PR I reviewed. The AI implemented; I made the decisions. More in [`docs/workflow.md`](docs/workflow.md).

Where I changed what the AI proposed:
- **A row for every unchanged poll.** It stored every poll as a full row: 96 copies of the same listing per competitor per day, while the timeline showed them as one line. I pushed back on the waste. Now a run of unchanged polls is one row with a check count, so history grows with changes, not with time.
- **The LLM for every change.** It sent every change to the LLM, a plain price change included. I asked why a price change needs an LLM at all. Now code summarises price, title and availability, and the cap is spent only on wording.

I also had business logic moved out of the repositories into a service layer, and the source client's retry loop rewritten into a pure classifier plus an explicit retry policy.
