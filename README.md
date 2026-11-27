# CompetitorPulse

Tracks competitor listings over time, decides when a listing changed in a way a product manager would care about, and explains the change in plain English.

**In short**
- `docker compose up --build`, then open http://localhost:8080.
- Every poll is recorded, including unchanged and failed ones. A run of unchanged polls (or of repeated 404s) is one row with a check count, not one row per poll. A change is decided on 4 normalised fields, so format noise never counts.
- Price, title and availability changes are summarised by my own code. The LLM is only used for wording changes, where interpretation actually helps.
- The source rate limit and the 2,000/day LLM cap are both enforced in a way that holds across restarts. When the numbers don't fit, the system slows down instead of breaking.
- [The production numbers don't fit](#the-production-numbers-dont-fit-what-id-do) is where most of my thinking went.

**Stack:** Node.js 24 + TypeScript (strict), Fastify, Zod, PostgreSQL with Drizzle migrations. React + Vite on the frontend, served by nginx in Docker. Polling, LLM summaries and retention run as background workers inside the API process.

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
I used **the provided mock LLM**: no cost, no key to share. It doesn't write real summaries. It echoes the first 160 characters of the prompt, so a "summary" looks like `Mock AI summary (not a real model). Based on what you sent: "Changed fields (1): tagline. Old tagline: …"`. I put the changes first in the prompt so the echo shows what was sent.

The client speaks the OpenAI Chat Completions format, so switching provider is just config:
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
I also tested everything against Ollama `llama3.2`, and the prompt design came out of those tests.

---

## What you'll see, and how to check it

- **List view:** add and remove competitors. Badges show **changed in the last 24 h**, and **never found at source** for ids that have only ever returned 404. I accept unknown ids and flag them, so a typo is visible rather than rejected.
- **Timeline view:** newest first. Each change is a card with the listing, the **old → new values**, and the summary or the reason there isn't one. A run of unchanged polls collapses into one line: `No change · 46 checks · 6:00 AM – 5:15 PM`.

**Code vs AI summaries.** A price, title or availability change gets a summary written by code, with no LLM call: *"Price dropped from $39/mo to $29/mo (-26%)."* (green **Summary**). Tagline and description changes go to the LLM (blue **AI summary**). You can check it with the provided fixtures:
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

The full reasoning for each part is in [`docs/epics/`](docs/epics).

### What counts as a change
- Every response is **normalised to 4 fields**: title, tagline, price, description. Noise fields are dropped, and HTML entities and whitespace are cleaned up. The price is parsed into `{amount, currency, period}`, so `$39/mo`, `$39.00/mo` and `USD 39 per month` are equal, and `Free` equals `$0/mo`. Comparing raw text or hashing the response would flag a change on almost every poll.
- **Changed** means a normalised field differs from the **last complete snapshot**. Any text edit counts, typo fixes included. Deciding how much it matters is the summary's job. I didn't use a similarity threshold, because it can hide a real one-word change.
- An **incomplete listing** is stored but never compared against. A **failed fetch** is never a change.
- **Delisting and relisting are changes**, but only after the listing had been seen. A 404 for an id that was never found means "never found at source".
- **Unknown ids are accepted.** The source can't tell me in advance which ids exist, a 404 can also mean "temporarily delisted", and checking on `POST` would make adding a competitor depend on a flaky, rate-limited source.

### Rate limit and scheduling
- **One global limiter** at 4 req/s, evenly spaced, never in bursts. I stay under the source's 5 because I can't see its counting window. A 429 pauses **every** request for the `Retry-After` time. Per-competitor limits wouldn't help, since the source's limit is global.
- Each attempt times out after 5 s. 5xx, timeouts and network errors are retried twice with backoff, then a `fetch_failed` snapshot stores every attempt's error. The next scheduled poll is the retry. I didn't re-poll failures early, because the rate limit is the real constraint.
- **The database is the queue.** Every second, the scheduler claims due competitors with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and moves their `next_poll_at` forward *before* fetching. A slow poll is never picked twice, several instances can share the work, and when polling falls behind, the interval stretches instead of a backlog building up. A Redis/BullMQ queue would be one more moving part for no gain at this size.

### How history is stored
- **Every poll is recorded** in `snapshots`, including unchanged, incomplete, 404 and failed polls, because the brief wants all of them visible for 90 days. Change detection and the write run in one transaction with the competitor row locked. The list view reads summary columns on `competitors`, so it never scans snapshots.
- **A quiet run is one row.** An unchanged poll after an unchanged poll, or a 404 after a 404, doesn't insert a row. It extends the newest one: `last_checked_at` moves forward and `check_count` goes up. 30 unchanged polls are one row with `check_count = 30`, which is exactly what the timeline shows (`No change · 30 checks · 10:13 – 10:21`). Changes, firsts, failures and incomplete listings are still one row each, and each one ends the run before it. What's given up is the time of each individual check inside a run; the count and the first and last check stay. Considered instead: a row per poll without the listing copy, which saves bytes but still means ~52M rows.
- **Retention keeps the changes and expires the noise.** An hourly job deletes uneventful snapshots whose last check is older than 90 days, in batches of 5,000. A run that started before the cutoff but is still being checked stays whole. Each competitor's newest row is never deleted either, so a poll after a long outage never extends a run across a failure. Changes and each competitor's first snapshot are kept for good. They're a tiny share of the rows, and they're the history people come back for ("when did they drop their price?"). Each competitor's **latest complete listing is never deleted**, however old, because the next poll is compared with it. Without that, a competitor delisted for 100 days would come back as a "first snapshot" instead of "back on the source, price dropped".

### The LLM and the cap
- **A poll never waits for the LLM.** The snapshot is saved first. A separate summary worker makes the call (same `SKIP LOCKED` pattern, newest change first, 120 s lease). A slow or failing LLM can't lose or delay a poll.
- **Code for structured changes, LLM for wording.** A price, title or availability change is summarised by code at poll time: free, instant, and never a wrong number.
- **Prompt:** the changes as labelled `Old …` / `New …` lines, then the current listing as context, never the raw response. The system prompt asks what changed and what it likely signals for a product manager, with two worked examples. Listing text is treated as data. This came from testing on llama3.2: an inline `"a" → "b"` format made it invent or reverse values in 4 out of 4 runs, and labelled lines fixed it. With several changes it first summarised only the most striking one (usually the price). The prompt now lists the changed fields up front, states the price change in words ("up 34%"), spells out an appended or removed sentence, and asks for every field plus one combined read. That took it from 0 to 10 out of 10 answers covering all three fields of a three-field change.
- **Cap:** counted per UTC day in Postgres and claimed atomically before each call (`… ON CONFLICT DO UPDATE … WHERE calls < cap`), so it holds across restarts and instances. Failed calls count too. So that an LLM outage can't spend the day on failures, **a circuit breaker** pauses summaries for 5 minutes after 5 failures in a row, then tries one call: an outage costs about 5 calls, not 4 per waiting change.
- **When there's no AI summary**, the old → new values are always shown, plus the reason:

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
6,000 polls every 15 min is **6.7 req/s** before retries. At my 4 req/s, one 15-minute window fits 3,600 polls, so up to 3,600 competitors keep their 15-minute interval. Past that, nothing breaks: every competitor is still polled in turn, oldest first, and the interval stretches. At 6,000 a full round takes **25 min**. The limit is never exceeded and no backlog builds up.

What I'd do next:
- **Poll quiet competitors less often.** The data is already there: `competitors.last_changed_at` is updated on every real change.
  - No change in the last 7 days → poll every 60 min. Changed recently, or new → every 15 min.
  - It adjusts itself. A quiet competitor that changes goes straight back to 15 min, which is when follow-up changes usually come. After 7 quiet days it drops to 60 min.
  - It's one `CASE` in `claimDue` that picks the interval from `last_changed_at`. No new tables.
  - Example: 1,000 active at 15 min (1.1 req/s) + 5,000 quiet at 60 min (1.4 req/s) = **2.5 req/s**, with room for retries.
  - The cost: a change on a quiet competitor is seen up to an hour late. I'd let users pin important competitors to 15 min. And I'd measure the real share of quiet competitors first, because if most are active this doesn't help much.
- **Ask the source owner** for a higher limit or a batch / "changes since" endpoint. One request for many ids beats any scheduling trick. Conditional requests (`ETag` → `304`) would also help on a real site; this source doesn't support them.
- **Poll new competitors first.** A newly added competitor currently waits behind overdue ones. Defaulting its `next_poll_at` to the past is a one-line fix.

### 2. 2,000 LLM calls a day
Spend can never go over 2,000, because of the cap. The real question is whether every change still gets a summary. Each step cuts what reaches the next:

| Step | Calls/day left |
|---|---|
| One call per poll (6,000 × 96) | 576,000 |
| Only real changes: noise fields, price formats, partial and failed responses don't count | = real changes/day |
| Code summaries for price, title and availability | = wording changes/day |
| The cap; the rest waits for the next UTC day with old → new still shown | ≤ 2,000 |

Change detection does most of the work. The code summaries only remove the structured share. **Break-even is one wording change per competitor every 3 days** (2,000 / 6,000). Weekly rewording is ~860 calls a day and fits. Daily rewording is 6,000 and doesn't.

**Past the cap, newest first.** At midnight the waiting changes become due again, and the worker takes the newest first. A summary loses value as it ages. Oldest first under steady overload would make every summary a bit later each day, so nothing would ever be current. Newest first has two side effects: the oldest overflow can wait forever, and one competitor rewording 50 times can crowd out others. So, next, in this order:
- **One summary per competitor:** three rewordings get one summary of the net change, which is cheaper and more useful. The queue then has one entry per competitor, so each competitor's latest state gets the summary.
- **Give up on stale ones:** after about 3 days, mark the change "not summarised: too old" and stop retrying. The old → new values stay.
- **Prioritise** by competitor importance or size of change, and say so in the UI.
- **Batch several competitors per call, only under cap pressure.** The cap counts calls, so 10 changes in one call would stretch it about tenfold. But a per-call cap is unusual: providers bill by tokens, so Finance probably means "keep the cost down". I'd check with them before relying on this. It also needs structured output with per-item validation, one timeout delays the whole batch, and the model can mix up details between competitors. It can't be shown with the mock either, since the mock only echoes the prompt.

### 3. History: 52 million polls, far fewer rows
6,000 × 96 polls a day × 90 days = **51.8M polls**. Stored one row per poll, most of those rows would be unchanged polls carrying a full copy of a listing we already have.
- **Built:** quiet runs (above). A competitor that doesn't change is one row per stretch between events, not 96 rows a day. Rows now grow with **changes, failures and incomplete listings**, not with polls. One flaky or reworded competitor still adds rows, but a quiet one barely does.
- **Built:** retention (above), using a partial index on exactly the rows it deletes.
- **Next:** partition `snapshots` by month, so an expired month goes with one instant `DROP` instead of batched deletes. Changes would be copied to a small table first so nothing is lost. With quiet runs this matters much less, since there's far less to expire.
- Reads are already bounded: the timeline is paginated and the list reads one row per competitor.

### 4. More instances don't help throughput
**One instance is the right size.** Every limit that matters is outside the process: the source allows 5 req/s in total and one process already uses 4, the LLM budget is 2,000 calls a day, and the UI has one internal user. A second poller wouldn't poll more competitors. It would only split the same 4 req/s, or exceed the limit, because the rate limiter lives in each process (two pollers would send 8 req/s).

A second instance is only worth it for **availability**, so a crash or a redeploy doesn't take the UI down. Claiming and the LLM cap are already safe across instances, so that works as long as polling runs in one of them (`SCHEDULER_ENABLED=false` on the other). Sharing the token bucket in Postgres or Redis would only matter if polling itself had to move between instances.

---

## How I'd use the LLM with real data: competitor trends
I built per-change summaries because the brief asks for them. Testing on Ollama, though, I noticed **the AI mostly restates a change you can already read in the old → new diff**. The fixtures are short one-liners. On real listings a rewritten paragraph is harder to read by eye, so I'd check this with real data and real users first.

If it holds up, I'd spend the budget differently:
- **Show the changes with plain code:** a highlighted diff per field, plus the code summaries that already exist.
- **Use a bigger model for what LLMs are actually good at:** a **trend summary per competitor**. A per-change summary answers "what changed?". A product manager wants to know "where is this competitor heading?". One change says little, but ten over two months show a pattern.

How I'd build it:
- **Input:** the list of changes with dates and old → new values, not raw snapshots. Retention keeps changes for good, so the history is always there.
- **On demand:** a "What's the trend?" button, `GET /api/competitors/:id/trend`. The result is stored until the competitor's next change, so competitors nobody opens cost nothing. It shares the daily cap.
- **Its own model:** `LLM_TREND_MODEL`, e.g. `qwen2.5:7b`. A slower answer is fine for something you ask for.

I tried it on llama3.2 with `orbit-hr`'s four changes (€8 → €10/seat/mo → €96/yr → free for teams under 10, and the tagline going from "HR for teams of 10 to 500" to "HR for growing teams"). It got the big picture right: a free tier for small teams and broader positioning. It got two details wrong. It called €96/yr "more premium", but that's €8/mo, so it's cheaper. And it cited the wrong change for the tagline. So before building it, I'd:
1. Do the maths in code and send `€10/seat/mo → €96/yr (≈ €8/mo, −20%)`, never raw prices.
2. Check every cited change in code, and reject the answer if a citation is wrong.
3. Label it in the UI as an AI interpretation, with links to the changes it cites.

I didn't build it: it goes beyond the brief (summaries between consecutive snapshots), and the mock would only echo the prompt back.

---

## How I'd deploy it
I skipped the cloud bonus on purpose: the whole system starts with one command, so you can run it as is. This is how I'd put it online.

### A demo: one VM, the same compose file
- **One small Linux VM** (2 GB RAM) with Docker, then `git clone` and `docker compose up -d --build`. No code changes are needed: nginx in the web container already serves the UI and proxies `/api` to the API, so the app is reached on **one port** (8080).
- **A firewall that allows only SSH and the web port.** The compose file also publishes Postgres (5433), the API (3000) and the two mock services. That's handy on a laptop, but on a public VM they must stay closed.
- **HTTPS without buying a domain:** put Caddy in front, with a free `<ip>.sslip.io` hostname. Caddy gets the certificate by itself.
- **A password:** there's no login (the brief assumes one internal user), so a public demo would get nginx basic auth.
- Migrations run on startup, and `/health` reports whether the database is reachable, so a restart or redeploy is just `git pull && docker compose up -d --build`.

### Production: split it by job
- **Managed Postgres** (RDS, Cloud SQL, Neon) instead of the container: backups, point-in-time restore and failover come with it.
- **One instance is enough.** The bottleneck is the source's rate limit, not our process (see section 4 above), so more replicas wouldn't poll faster. A platform that restarts the container when `/health` fails covers most of the availability need.
- **If downtime during a crash or redeploy matters:** split it into an API service with `SCHEDULER_ENABLED=false` (two copies behind a load balancer that checks `/health`) and **one worker** with the scheduler on (polling, summaries, retention). Polling stays in that single worker, because the rate limiter lives in one process.
- **The web bundle as static files on a CDN** (S3 + CloudFront or similar), with `/api` routed to the API.
- **Secrets from the platform** (the LLM key, the database URL) instead of the compose file. `SOURCE_BASE_URL` and `LLM_BASE_URL` point at the real source and LLM.
- **Logs and alerts:** the JSON logs go to the platform's log service, with alerts on "summaries paused" (the LLM circuit breaker), repeated `fetch_failed` polls, and the daily cap running out early.
- **CI:** typecheck and tests on each PR against a Postgres service container, then build and deploy the image on merge.

---

## Left out on purpose
- **Auth:** the brief assumes one internal user.
- **The scaling steps above** (quiet-competitor intervals, partitioning, shared limiter, one summary per competitor, expiring stale summaries, batching): described, not built. Retention, quiet runs and the LLM circuit breaker are built.
- **Competitor trend summaries:** designed and tried on Ollama, not built.
- **Cloud deployment** (bonus): skipped to keep the time reasonable. How I'd do it is described above.
- **Fine-tuning:** no budget, not possible on the mock, and the problem is prompting, not model knowledge.
- **Notifications** (email/Slack) and **soft delete**.
- **Browser e2e tests:** I tested the UI by hand in Chrome. Automated tests cover the API, the domain logic and the UI's grouping logic (174 API + 5 web tests).

## How I worked, and AI tools
I built this with **Claude Code** as a pair programmer, spec first. The AI implemented; I made the decisions. Full write-up: [`docs/workflow.md`](docs/workflow.md).

1. **Brief first.** I pulled out what the brief requires, leaves open and scores, before any code.
2. **Epics in a deliberate order:** setup and Docker first (so everything after runs in the real setup), then competitors, polling, AI summaries, and finally the README.
3. **A spec per epic** ([`docs/epics/`](docs/epics)): goal, scope and out of scope, decisions marked DECIDED / PROPOSED / OPEN, failure modes, stories, and how to verify it.
4. **One AI session per epic,** working from the spec on its own branch, merged through a PR I reviewed (#1–#4, and #10 for quiet-run storage).
5. **Refactors and improvements as separate PRs** after review (#5, #7–#9, #11–#13), and specs updated to match what was actually built.

Where I changed what the AI proposed:
- **A row for every unchanged poll.** It stored every poll as a full row, so 96 unchanged polls a day per competitor were 96 copies of the same listing, while the timeline showed them as one line. I pushed back on the waste; now a run of unchanged polls is one row with a check count, so history grows with changes, not with time.
- **LLM for every change.** It sent every change to the LLM, including a plain price change. I asked why a price change needs an LLM at all. Now code writes summaries for price, title and availability, and the cap is spent only on wording.
- **Layering.** The first version put business logic in the persistence layer: change detection ran inside the snapshot repository, and routes held rules like "duplicate → 409". I had it split into routes → services → repositories. The service owns the transaction and calls a pure change-detection function, and domain errors map to HTTP in one place.
- **Readability.** I had the source client's retry loop split into a pure response classifier plus an explicit retry policy, comments cut back, and methods renamed so each layer has its own vocabulary (`competitorService.startTracking` vs `competitorRepository.insert`).
- **The prompt.** I asked for a system prompt that explains the goal (competitive intelligence for a product manager) and for the current listing to be sent as context, so the model understands the product, not just the changed field.
