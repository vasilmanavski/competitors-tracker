// Integration: retention purge on a real Postgres.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { createDb, runMigrations } from "../db/client.ts";
import type { PollOutcome } from "../listings/change-detection.ts";
import { normalizeListing } from "../listings/normalize.ts";
import { createServices } from "../services.ts";
import { createRetentionService } from "./service.ts";

const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/competitorpulse_test";
const { pool, db } = createDb(url);
const services = createServices(db);
const silent = { info() {} };
const DAY_MS = 24 * 60 * 60 * 1000;

const listing = (patch: Record<string, unknown> = {}): PollOutcome => ({
  status: "ok",
  listing: normalizeListing({
    title: "Acme CRM",
    tagline: "Simple CRM for small teams",
    price: "$39/mo",
    description: "Track leads & deals in one place.",
    ...patch,
  })!,
});
const incomplete: PollOutcome = { status: "partial", listing: normalizeListing({ title: "Acme CRM", price: "$39/mo" })! };
const failed: PollOutcome = { status: "fetch_failed", error: "HTTP 503 (3 attempts)" };
const notFound: PollOutcome = { status: "not_found" };

const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

async function record(competitorId: string, days: number, outcome: PollOutcome) {
  const recorded = await services.snapshotService.recordPoll(competitorId, outcome, daysAgo(days));
  assert.ok(recorded);
  return recorded.snapshot;
}

async function remainingStatuses(competitorId: string): Promise<string[]> {
  const result = await db.execute<{ summary_status: string; age: number }>(sql`
    select summary_status, round(extract(epoch from now() - fetched_at) / 86400)::int as age
    from snapshots where competitor_id = ${competitorId} order by fetched_at`);
  return result.rows.map((row) => `${row.age}d ${row.summary_status}`);
}

const retention = (batchSize?: number) =>
  createRetentionService({ data: services.data, retentionDays: 90, log: silent, batchSize });

before(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate competitors, llm_usage cascade`);
});
after(async () => {
  await pool.end();
});

describe("retention", () => {
  test("old uneventful polls go; changes, the first snapshot, the baseline and recent polls stay", async () => {
    await services.competitorService.startTracking("acme-crm");
    await record("acme-crm", 200, listing()); // first snapshot: kept
    await record("acme-crm", 199, listing()); // no change: purged
    await record("acme-crm", 198, failed); // purged
    await record("acme-crm", 197, incomplete); // purged
    await record("acme-crm", 196, listing({ price: "$29/mo" })); // change: kept
    await record("acme-crm", 195, listing({ price: "$29/mo" })); // no change: purged
    await record("acme-crm", 10, listing({ price: "$29/mo" })); // recent: kept, and the baseline

    const deleted = await retention().purgeExpiredSnapshots();

    assert.equal(deleted, 4);
    assert.deepEqual(await remainingStatuses("acme-crm"), ["200d first_snapshot", "196d summarized", "10d not_changed"]);
  });

  test("a competitor delisted for longer than the retention keeps its last listing as the baseline", async () => {
    await services.competitorService.startTracking("gone");
    await record("gone", 150, listing()); // first snapshot
    await record("gone", 149, listing()); // no change, but the latest complete listing: the baseline
    await record("gone", 148, notFound); // delisted: a change
    for (let day = 147; day >= 100; day--) await record("gone", day, notFound); // still not listed: purged

    await retention().purgeExpiredSnapshots();
    assert.deepEqual(await remainingStatuses("gone"), ["150d first_snapshot", "149d not_changed", "148d summarized"]);

    const back = await record("gone", 0, listing({ price: "$29/mo" }));
    assert.equal(back.summaryStatus, "summarized");
    assert.equal(back.summary, "Back on the source after being unavailable. Price dropped from $39/mo to $29/mo (-26%).");
  });

  test("purges in batches until nothing expired is left", async () => {
    await services.competitorService.startTracking("acme-crm");
    await record("acme-crm", 120, listing());
    for (let day = 119; day >= 100; day--) await record("acme-crm", day, listing());
    await record("acme-crm", 1, listing());

    assert.equal(await retention(3).purgeExpiredSnapshots(), 20);
    assert.equal(await retention(3).purgeExpiredSnapshots(), 0);
  });

  test("nothing inside the retention period is touched", async () => {
    await services.competitorService.startTracking("acme-crm");
    for (let day = 89; day >= 0; day--) await record("acme-crm", day, day % 7 === 0 ? failed : listing());
    assert.equal(await retention().purgeExpiredSnapshots(), 0);
  });

  test("an abort stops the purge", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(retention().purgeExpiredSnapshots(controller.signal));
  });
});
