# Epic 1 — Add, list & remove competitors

> Status legend: **DECIDED** = confirmed by me · **PROPOSED** = recommended, not yet confirmed · **OPEN** = still to decide

## Goal
**In one line:** the user can choose which competitors to watch.

A user can add, list and remove tracked competitors by id, through the API and the React list view.

**Definition of done:** in the UI, add `acme-crm` → it appears in the list → remove it → it's gone. The same works with curl against the API contract.

## Key concept
A **competitor** is a rival product we watch, e.g. `acme-crm`. Adding an id means "start watching this rival's listing page". Competitors are independent of each other. The source has no "list all" endpoint, so we only ever know about and fetch the ids users add.

## Scope
- `competitors` table + migration.
- The 3 endpoints of the contract below.
- React **Competitor list** view: list, add form, remove button, inline errors.

## Out of scope
- The "changed in last 24 h" indicator. It needs snapshot data, so it moves to **Epic 2**.
- Polling / snapshots (Epic 2).
- Auth: the brief says to assume one internal user.

## Data model
```
competitors
  id          text primary key      -- e.g. "acme-crm"
  created_at  timestamptz not null default now()
```
Epic 2 will add scheduling columns (`next_poll_at`, `last_polled_at`).

## API contract (from the brief)
```
GET    /api/competitors                       -> 200 [{ "id": string }, ...]
POST   /api/competitors      { "id": string } -> 201 Created
DELETE /api/competitors/:id                   -> 204 No Content
```
Extra fields can be added to the list response later (e.g. `changedLast24h` in Epic 2).

## Decisions
| # | Decision | Status |
|---|---|---|
| 1.1 | **Delete = hard delete, with cascade to all snapshots.** Re-adding starts a fresh history. Alternative considered: soft delete (stop polling, keep history, resume on re-add). | **DECIDED** |
| 1.2 | **Unknown id → accept (201)** and schedule it for polling right away. The timeline then shows `not_found`. We never reject on a source 404, because 404 also means "temporarily delisted", and a request-time check against a rate-limited, flaky source would make `POST` flaky too. | **PROPOSED** |
| 1.3 | Id validation: trim + lowercase, must match `^[a-z0-9-]{1,64}$`. Otherwise 400 with a message. | **PROPOSED** |
| 1.4 | Duplicate add → **409 Conflict**. Alternative: idempotent 201. | **PROPOSED** |
| 1.5 | Delete of an unknown id → 404. Alternative: idempotent 204. | **OPEN** |

## Failure modes
- Malformed id → 400, the error is shown inline in the form.
- Duplicate → 409, "already tracked".
- API unreachable → the UI shows an error state, not a blank list.

## Stories
_To be derived when this epic starts._

## Verification
```bash
curl -X POST localhost:<api>/api/competitors -H 'content-type: application/json' -d '{"id":"acme-crm"}'   # 201
curl -X POST ... -d '{"id":"acme-crm"}'        # 409
curl -X POST ... -d '{"id":"Bad Id!"}'         # 400
curl -X POST ... -d '{"id":"does-not-exist"}'  # 201 (unknown ids accepted)
curl localhost:<api>/api/competitors           # list
curl -X DELETE localhost:<api>/api/competitors/acme-crm   # 204
```
Plus the same flow manually in the UI.

## Decision log → README
- Unknown-id policy (1.2) and why.
- Hard delete vs soft delete (1.1).
