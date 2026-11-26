# Epic 0 — Project setup & one-command startup

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide

## Goal
**In one line:** set up the empty project so that `docker compose up` runs every piece (database, fake source, fake LLM, API, UI) before any feature is built.

`docker compose up` starts the whole system: Postgres, the listing source, the mock LLM, the API and the web app. The database schema is created by a migration tool and nothing else, and the web app shows a response from the API.

**Definition of done:** on a clean clone, `docker compose up` → open the web app → it shows "API OK". `GET /health` returns 200, and the migration table exists in Postgres.

## Why this epic exists
The brief scores one-command startup ("`docker compose up` must start the whole system") and "a real database with migrations … set up with one command". If these come first, every later epic is built and tested inside the real setup.

## Scope
- Repo layout: `api/`, `web/`, `docker-compose.yml`, `docs/`.
- Compose services:
  - `postgres`
  - `listing-source`: runs the provided `files/listing-source/listing-source-server.mjs`, unmodified
  - `mock-llm`: runs the provided `files/mock-llm/mock-llm-server.py`, unmodified
  - `api`
  - `web`
- Typed config loaded from env vars at startup. The app fails fast on invalid config.
- The migration tool is wired in, and migrations run automatically when the API starts.
- `GET /health` endpoint.
- Web app that calls the API and shows the result.

## Out of scope
- Any business tables or endpoints (Epic 1+).
- Cloud deployment (bonus, revisit after Epic 4 if time allows).

## Decisions
| # | Decision | Status |
|---|---|---|
| 0.1 | Epic structure is 0–4. The skeleton comes first. | **DECIDED** |
| 0.2 | Backend: Node.js + TypeScript (strict). The brief prefers TS. | **DECIDED** (brief) |
| 0.3 | Frontend: React (Vite + TS). | **DECIDED** (brief) |
| 0.4 | Database: PostgreSQL. Alternative considered: SQLite. It's simpler, but a weak story for 6,000 competitors × 90 days. | **PROPOSED** |
| 0.5 | ORM + migrations: Drizzle (`drizzle-kit generate` → SQL files, applied at startup). Alternatives: Prisma (its CLI just changed in v8, so tutorials disagree), Knex (weak typing). | **PROPOSED** |
| 0.6 | HTTP framework: Fastify v5 + Zod validation. Alternative: Express (most familiar, but no built-in validation or typed routes). | **PROPOSED** |
| 0.7 | Run TS natively on Node ≥ 22.18 (type stripping; raised to Node 24 in Epic 4 to match the npm that writes the lockfiles) + `tsc --noEmit` for type checks. Alternatives: `tsx`, or compiling to `dist/`. | **PROPOSED** |
| 0.8 | The provided source and mock LLM run unmodified as their own compose services. They are reached only through env URLs, so graders can swap them out. | **DECIDED** (brief) |

### Config (env)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `SOURCE_BASE_URL` | Listing source base URL. It must be configurable: graders point it at their own instance. |
| `POLL_INTERVAL_SECONDS` | How often each competitor is polled (used in Epic 2) |
| `SOURCE_RATE_LIMIT_PER_SECOND` | Our outgoing limit to the source (Epic 2) |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_DAILY_CAP` | LLM settings (Epic 3) |

## Failure modes
- Postgres isn't ready when the API starts → the API waits or retries (compose `healthcheck` + `depends_on: condition: service_healthy`).
- Bad or missing env → the process exits on startup with a clear message.

## Stories
_Implemented 2026-11-25 using the PROPOSED choices 0.4–0.7. Confirm or change them before Epic 1 builds on them._

1. **API config**: `api/src/config.ts`. Zod schema over `process.env`, which lists every invalid var and exits with code 1.
2. **DB + migrations**: `api/src/db/client.ts`. Startup order: wait for the DB (retries for 30 s) → `migrate()` from `api/drizzle/` → listen. The baseline migration `0000_init.sql` creates no tables, but `drizzle.__drizzle_migrations` exists afterwards.
3. **Health**: `GET /health` (for ops and compose) and `GET /api/health` (for the web app through the proxy). Each runs `select 1` and answers 503 when the DB is down.
4. **Web**: Vite + React. It calls `/api/health` and shows "API OK". In dev, Vite proxies `/api` → `:3000`. In Docker, nginx proxies `/api/` → `api:3000`. Both are same-origin, so CORS is never needed.
5. **Compose**: 5 services with healthchecks, started in dependency order (postgres, source, llm → api → web). The provided servers are copied unmodified into `provided/` and bind-mounted read-only.

6. **Local dev without Docker** (dev laptop has no Docker; compose is verified on a personal machine): `npm run setup` once, then `npm run dev:all` starts source, mock LLM, API (`--watch`, loads `api/.env`) and Vite on `:5173` against the local Postgres DB `competitorpulse`. Known gaps vs Docker: service hostnames, nginx proxy, Dockerfiles, Postgres 14 locally vs 17 in compose. Run compose early to catch these.

Ports: web `8080`, api `3000`, source `4002`, mock LLM `4001`, postgres `5433` on the host.


## Verification
- `docker compose up` on a clean checkout → all 5 services are healthy.
- `curl localhost:<api>/health` → 200.
- `curl localhost:4002/health` and `curl localhost:4001/health` → 200.
- The web app shows "API OK".
- `psql` → the migration history table exists.

## Decision log → README
- Stack choices (0.4–0.7) and the alternatives considered.
- How to point at a different source / LLM: env vars only.
