// Integration: poller + scheduler + snapshot API against a real Postgres, with
// a scripted source client (the HTTP edge cases are in source-client.test.ts).
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { createDb, runMigrations } from "../db/client.ts";
import { createServices } from "../services.ts";
import type { FetchResult, SourceClient } from "../source/source-client.ts";
import { createPollingService } from "./service.ts";
import { createScheduler } from "./scheduler.ts";

const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/competitorpulse_test";
const { pool, db } = createDb(url);
const services = createServices(db);
const app = buildApp(services, { logger: false });
const competitorRepository = services.data.repositories.competitorRepository;
const claimDueHourly = (limit: number, excludeIds: string[]) => competitorRepository.claimDue(limit, 3600, excludeIds);
const silent = { info() {}, warn() {}, error() {} };

// Each fetchListing() returns the next scripted result for that id.
const scripts = new Map<string, FetchResult[]>();
const source: SourceClient = {
  async fetchListing(id) {
    const next = scripts.get(id)?.shift();
    if (!next) throw new Error(`no scripted result for ${id}`);
    return next;
  },
};
const poll = createPollingService({
  source,
  snapshotService: services.snapshotService,
  competitorRepository,
  intervalSeconds: 3600,
  log: silent,
}).pollCompetitor;

const body = (patch: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  body: {
    id: "acme-crm",
    title: "Acme CRM",
    tagline: "Simple CRM for small teams",
    price: "$39/mo",
    description: "Track leads & deals in one place.",
    requestId: crypto.randomUUID(),
    renderedAt: new Date().toISOString(),
    viewerCount: Math.floor(Math.random() * 200),
    ...patch,
  },
});

const add = (id: string) => app.inject({ method: "POST", url: "/api/competitors", payload: { id } });
const timeline = async (id: string, qs = "") => {
  const res = await app.inject({ method: "GET", url: `/api/competitors/${id}/snapshots${qs}` });
  return { status: res.statusCode, rows: res.json() };
};
const listRow = async (id: string) =>
  (await app.inject({ method: "GET", url: "/api/competitors" })).json().find((c: { id: string }) => c.id === id);

before(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate competitors cascade`);
  scripts.clear();
});
after(async () => {
  await app.close();
  await pool.end();
});

describe("polling → snapshots → timeline", () => {
  test("the full life of a listing, newest first", async () => {
    await add("acme-crm");
    scripts.set("acme-crm", [
      body(), // 1 first
      body({ price: "USD 39.00 per month", title: "  Acme&nbsp;CRM\n", promoBanner: "Sale!" }), // 2 same content
      body({ price: null }), // 3 partial
      body({ price: "$29 / month" }), // 4 real change
      { kind: "failed", error: "HTTP 503 (3 attempts)", attempts: 3 }, // 5 failure
      { kind: "not_found" }, // 6 delisted
      { kind: "not_found" }, // 7 still delisted
      body({ price: "$29/mo" }), // 8 relisted, same as last ok
    ]);
    for (let i = 0; i < 8; i++) await poll("acme-crm");

    const { status, rows } = await timeline("acme-crm");
    assert.equal(status, 200);
    const summary = rows.map((s: Record<string, unknown>) => [s.status, s.changed, s.summaryStatus, s.changedFields]);
    assert.deepEqual(summary.reverse(), [
      ["ok", false, "first_snapshot", []],
      ["ok", false, "not_changed", []],
      ["partial", false, "incomplete_listing", []],
      ["ok", true, "summarized", ["price"]],
      ["fetch_failed", false, "fetch_failed", []],
      ["not_found", true, "summarized", ["availability"]],
      ["not_found", false, "not_found", []],
      ["ok", true, "summarized", ["availability"]],
    ]);

    const [relisted, , , failed, , partial, , first] = rows;
    assert.equal(first.title, "Acme CRM");
    assert.equal(first.price, "$39/mo");
    assert.equal(first.description, "Track leads & deals in one place.");
    assert.equal(first.summary, null);
    assert.deepEqual(partial.missingFields, ["price"]);
    assert.equal(failed.error, "HTTP 503 (3 attempts)");
    assert.equal(relisted.price, "$29/mo");
    assert.deepEqual(relisted.priceDetail, { amount: 29, currency: "USD", period: "month" });
    for (const key of ["fetchedAt", "title", "tagline", "price", "description", "changed", "summary"]) {
      assert.ok(key in first, `snapshot has ${key}`);
    }

    const row = await listRow("acme-crm");
    assert.equal(row.changedLast24h, true);
    assert.equal(row.lastStatus, "ok");
    assert.equal(row.listingState, "listed");
    assert.equal(row.neverFound, false);
  });

  test("an id the source never knew: not_found, flagged neverFound, never 'changed'", async () => {
    await add("qweqweqweqeqe");
    scripts.set("qweqweqweqeqe", [{ kind: "not_found" }, { kind: "not_found" }]);
    await poll("qweqweqweqeqe");
    await poll("qweqweqweqeqe");
    const { rows } = await timeline("qweqweqweqeqe");
    assert.deepEqual(rows.map((s: { changed: boolean }) => s.changed), [false, false]);
    const row = await listRow("qweqweqweqeqe");
    assert.equal(row.neverFound, true);
    assert.equal(row.changedLast24h, false);
  });

  test("a freshly added competitor: [] timeline, not yet polled", async () => {
    await add("fresh");
    assert.deepEqual((await timeline("fresh")).rows, []);
    const row = await listRow("fresh");
    assert.equal(row.lastPolledAt, null);
    assert.equal(row.changedLast24h, false);
  });

  test("a competitor removed mid-poll: the poll is dropped, nothing breaks", async () => {
    await add("gone");
    await app.inject({ method: "DELETE", url: "/api/competitors/gone" });
    scripts.set("gone", [body()]);
    await poll("gone"); // no throw
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from snapshots`)).rows as [{ n: number }];
    assert.equal(n, 0);
  });

  test("removing a competitor deletes its history (decision 1.1)", async () => {
    await add("acme-crm");
    scripts.set("acme-crm", [body()]);
    await poll("acme-crm");
    await app.inject({ method: "DELETE", url: "/api/competitors/acme-crm" });
    await add("acme-crm");
    assert.deepEqual((await timeline("acme-crm")).rows, []);
  });
});

describe("GET /api/competitors/:id/snapshots", () => {
  test("untracked id → 404, malformed id → 400, bad query → 400", async () => {
    assert.equal((await timeline("nope")).status, 404);
    assert.equal((await timeline("Bad%20Id!")).status, 400);
    await add("acme-crm");
    assert.equal((await timeline("acme-crm", "?limit=0")).status, 400);
    assert.equal((await timeline("acme-crm", "?before=yesterday")).status, 400);
  });

  test("limit + before page through the history", async () => {
    await add("acme-crm");
    scripts.set("acme-crm", Array.from({ length: 5 }, () => body()));
    for (let i = 0; i < 5; i++) await poll("acme-crm");
    const page1 = (await timeline("acme-crm", "?limit=2")).rows;
    const page2 = (await timeline("acme-crm", `?limit=2&before=${encodeURIComponent(page1[1].fetchedAt)}`)).rows;
    const all = (await timeline("acme-crm")).rows;
    assert.deepEqual([...page1, ...page2].map((s: { id: number }) => s.id), all.slice(0, 4).map((s: { id: number }) => s.id));
  });
});

describe("scheduling", () => {
  test("claimDue: due rows once, oldest first, limited, then not again within the interval", async () => {
    for (const id of ["a", "b", "c"]) await add(id);
    await db.execute(sql`update competitors set next_poll_at = now() - interval '1 minute' where id = 'c'`);
    assert.deepEqual(await competitorRepository.claimDue(1, 60), ["c"]);
    assert.deepEqual((await competitorRepository.claimDue(10, 60, ["a"])).sort(), ["b"]);
    assert.deepEqual((await competitorRepository.claimDue(10, 60)).sort(), ["a"]);
    assert.deepEqual(await competitorRepository.claimDue(10, 60), []);
  });

  test("scheduler polls due competitors; one crashing poll doesn't stop the others", async () => {
    for (const id of ["ok-1", "boom", "ok-2"]) await add(id);
    const polled: string[] = [];
    const scheduler = createScheduler({
      claimDue: claimDueHourly,
      maxInFlight: 10,
      tickMs: 20,
      log: silent,
      runJob: async (id) => {
        polled.push(id);
        if (id === "boom") throw new Error("kaboom");
      },
    });
    scheduler.start();
    await sleep(150);
    await add("late"); // added while running → due immediately (decision 2.12)
    await sleep(150);
    await scheduler.stop();
    assert.deepEqual(polled.sort(), ["boom", "late", "ok-1", "ok-2"]);
  });

  test("scheduler respects maxInFlight", async () => {
    for (const id of ["a", "b", "c", "d"]) await add(id);
    let running = 0;
    let peak = 0;
    const scheduler = createScheduler({
      claimDue: claimDueHourly,
      maxInFlight: 2,
      tickMs: 10,
      log: silent,
      runJob: async () => {
        peak = Math.max(peak, ++running);
        await sleep(60);
        running--;
      },
    });
    scheduler.start();
    await sleep(300);
    await scheduler.stop();
    assert.equal(peak, 2);
  });
});
