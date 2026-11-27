// Integration: summary service + repositories on a real Postgres, with a scripted LLM.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { createDb, runMigrations } from "../db/client.ts";
import type { PollOutcome } from "../listings/change-detection.ts";
import { normalizeListing } from "../listings/normalize.ts";
import { createServices } from "../services.ts";
import type { ChatMessage, CompletionResult, LlmClient } from "../clients/llm/llm-client.ts";
import { createSummaryService, nextUtcMidnight } from "./service.ts";

const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/competitorpulse_test";
const { pool, db } = createDb(url);
const services = createServices(db);
const app = buildApp(services, { logger: false });
const { snapshotRepository, llmUsageRepository } = services.data.repositories;
const silent = { info() {}, warn() {} };
const MINUTE_MS = 60_000;

let answers: CompletionResult[] = [];
let prompts: ChatMessage[][] = [];
const llm: LlmClient = {
  async complete(messages) {
    prompts.push(messages);
    return answers.shift() ?? { kind: "answer", content: "The tagline now pitches the CRM as loved by small teams.", finishReason: "stop" };
  },
};
const summaryService = (dailyCap = 100) => createSummaryService({ data: services.data, llm, dailyCap, log: silent });

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

let clock = Date.now() - 24 * 60 * MINUTE_MS;
async function record(competitorId: string, outcome: PollOutcome) {
  clock += MINUTE_MS;
  const recorded = await services.snapshotService.recordPoll(competitorId, outcome, new Date(clock));
  assert.ok(recorded);
  return recorded.snapshot;
}

/** Adds a competitor and records first → unchanged → a wording change (an LLM job); returns the changed snapshot. */
async function trackWithTaglineChange(id = "acme-crm") {
  await services.competitorService.startTracking(id);
  await record(id, listing());
  await record(id, listing({ price: "USD 39 per month" }));
  return record(id, listing({ tagline: "The CRM small teams love" }));
}

async function makeDueNow(snapshotId: number) {
  await db.execute(sql`update snapshots set summary_next_attempt_at = now() where id = ${snapshotId}`);
}

const reload = async (id: number) => (await snapshotRepository.findById(id))!;

before(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate competitors, llm_usage cascade`);
  answers = [];
  prompts = [];
});
after(async () => {
  await app.close();
  await pool.end();
});

describe("recording a change", () => {
  test("a wording change is stored with old → new values and queued for the LLM; other polls are not", async () => {
    const changed = await trackWithTaglineChange();
    assert.deepEqual(changed.changes, [{ field: "tagline", before: "Simple CRM for small teams", after: "The CRM small teams love" }]);
    assert.equal(changed.summaryStatus, "pending");
    assert.notEqual(changed.summaryNextAttemptAt, null);

    const queued = await db.execute<{ n: number }>(sql`select count(*)::int as n from snapshots where summary_next_attempt_at is not null`);
    assert.equal(queued.rows[0]?.n, 1);
  });

  test("a price change is summarised by our rules at once: no LLM job", async () => {
    await services.competitorService.startTracking("acme-crm");
    await record("acme-crm", listing());
    const changed = await record("acme-crm", listing({ price: "$29 / month" }));
    assert.deepEqual(changed.changes, [{ field: "price", before: "$39/mo", after: "$29/mo" }]);
    assert.equal(changed.summaryStatus, "summarized");
    assert.equal(changed.summarySource, "rule");
    assert.equal(changed.summary, "Price dropped from $39/mo to $29/mo (-26%).");
    assert.equal(changed.summaryNextAttemptAt, null);
    assert.deepEqual(await summaryService().claimDue(10, []), []);
  });

  test("a delisting is listed → not listed, summarised by our rules", async () => {
    await services.competitorService.startTracking("acme-crm");
    await record("acme-crm", listing());
    const delisted = await record("acme-crm", { status: "not_found" });
    assert.deepEqual(delisted.changes, [{ field: "availability", before: "listed", after: "not listed" }]);
    assert.equal(delisted.summarySource, "rule");
  });

  test("a price change together with a wording change goes to the LLM as one job", async () => {
    await services.competitorService.startTracking("acme-crm");
    await record("acme-crm", listing());
    const changed = await record("acme-crm", listing({ price: "$29/mo", description: "Now with AI follow-ups." }));
    assert.equal(changed.summaryStatus, "pending");
    assert.equal(changed.changes.length, 2);
  });
});

describe("summarising", () => {
  test("a due change gets a summary; the prompt holds only the changes", async () => {
    const changed = await trackWithTaglineChange();
    const service = summaryService();
    const claimed = await service.claimDue(10, []);
    assert.deepEqual(claimed, [String(changed.id)]);
    await service.summarizeSnapshot(claimed[0]!);

    const stored = await reload(changed.id);
    assert.equal(stored.summaryStatus, "summarized");
    assert.equal(stored.summary, "The tagline now pitches the CRM as loved by small teams.");
    assert.equal(stored.summarySource, "llm");
    assert.equal(stored.summaryNextAttemptAt, null);
    assert.equal(prompts.length, 1);
    assert.equal(
      prompts[0]?.at(-1)?.content,
      [
        "Changed fields (1): tagline.",
        'Old tagline: "Simple CRM for small teams"',
        'New tagline: "The CRM small teams love"',
        "Competitor: Acme CRM (acme-crm).",
        "",
        "Current listing, for context only:",
        'Title: "Acme CRM"',
        'Tagline: "The CRM small teams love"',
        'Price: "$39/mo"',
        'Description: "Track leads & deals in one place."',
      ].join("\n"),
    );
    assert.equal(await llmUsageRepository.findCallsToday(), 1);
  });

  test("unchanged polls never reach the LLM", async () => {
    await services.competitorService.startTracking("acme-crm");
    for (let i = 0; i < 5; i++) await record("acme-crm", listing({ price: i % 2 ? "$39.00/mo" : "USD 39 per month" }));
    assert.deepEqual(await summaryService().claimDue(10, []), []);
    assert.equal(prompts.length, 0);
  });

  test("a claimed snapshot is not claimed again while its lease runs", async () => {
    await trackWithTaglineChange();
    const service = summaryService();
    assert.equal((await service.claimDue(10, [])).length, 1);
    assert.deepEqual(await service.claimDue(10, []), []);
  });

  test("newest change is claimed first", async () => {
    const older = await trackWithTaglineChange("older");
    const newer = await trackWithTaglineChange("newer");
    assert.deepEqual(await summaryService().claimDue(1, []), [String(newer.id)]);
    assert.ok(newer.fetchedAt > older.fetchedAt);
  });

  test("timeouts are retried after 1, 5 and 15 minutes, then given up", async () => {
    const changed = await trackWithTaglineChange();
    const service = summaryService();
    const delays: (number | null)[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      answers.push({ kind: "timeout" });
      const before = Date.now();
      await service.summarizeSnapshot(String(changed.id));
      const stored = await reload(changed.id);
      assert.equal(stored.summaryStatus, "llm_timeout");
      assert.equal(stored.summaryAttempts, attempt);
      delays.push(stored.summaryNextAttemptAt && Math.round((stored.summaryNextAttemptAt.getTime() - before) / MINUTE_MS));
      if (stored.summaryNextAttemptAt) await makeDueNow(changed.id);
    }
    assert.deepEqual(delays, [1, 5, 15, null]);
    assert.deepEqual(await service.claimDue(10, []), []);
  });

  test("an LLM failure keeps its error and is retried; a later success replaces it", async () => {
    const changed = await trackWithTaglineChange();
    const service = summaryService();
    answers.push({ kind: "failed", error: "HTTP 500: injected failure" });
    await service.summarizeSnapshot(String(changed.id));
    let stored = await reload(changed.id);
    assert.equal(stored.summaryStatus, "llm_failed");
    assert.equal(stored.summaryError, "HTTP 500: injected failure");

    await makeDueNow(changed.id);
    await service.summarizeSnapshot(String(changed.id));
    stored = await reload(changed.id);
    assert.equal(stored.summaryStatus, "summarized");
    assert.equal(stored.summaryError, null);
  });

  for (const [label, answer, reason] of [
    ["empty", { kind: "answer", content: "  ", finishReason: "stop" }, /empty/],
    ["cut off", { kind: "answer", content: "Price dropped from", finishReason: "length" }, /cut off/],
    ["not a completion", { kind: "malformed", reason: "response did not have the chat completion shape" }, /shape/],
  ] as const) {
    test(`unusable answer (${label}) → unusable_output, not retried`, async () => {
      const changed = await trackWithTaglineChange();
      answers.push(answer);
      await summaryService().summarizeSnapshot(String(changed.id));
      const stored = await reload(changed.id);
      assert.equal(stored.summaryStatus, "unusable_output");
      assert.match(stored.summaryError ?? "", reason);
      assert.equal(stored.summaryNextAttemptAt, null);
    });
  }

  test("daily cap reached → no LLM call, deferred to the next UTC midnight", async () => {
    const first = await trackWithTaglineChange("first");
    const second = await trackWithTaglineChange("second");
    const service = summaryService(1);
    await service.summarizeSnapshot(String(first.id));
    await service.summarizeSnapshot(String(second.id));

    assert.equal((await reload(first.id)).summaryStatus, "summarized");
    const capped = await reload(second.id);
    assert.equal(capped.summaryStatus, "daily_cap_reached");
    assert.equal(capped.summaryAttempts, 0);
    assert.equal(capped.summaryNextAttemptAt?.toISOString(), nextUtcMidnight(new Date()).toISOString());
    assert.equal(prompts.length, 1);
  });

  test("the cap holds under concurrent claims", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => llmUsageRepository.incrementCallsIfBelow(3)));
    assert.equal(results.filter(Boolean).length, 3);
    assert.equal(await llmUsageRepository.findCallsToday(), 3);
  });

  test("a cap of 0 disables LLM calls", async () => {
    assert.equal(await llmUsageRepository.incrementCallsIfBelow(0), false);
  });

  test("a competitor removed before its summary: nothing breaks", async () => {
    const changed = await trackWithTaglineChange();
    await services.competitorService.stopTracking("acme-crm");
    await summaryService().summarizeSnapshot(String(changed.id));
    assert.equal(prompts.length, 0);
  });

  test("an already summarised snapshot is not summarised again", async () => {
    const changed = await trackWithTaglineChange();
    const service = summaryService();
    await service.summarizeSnapshot(String(changed.id));
    await service.summarizeSnapshot(String(changed.id));
    assert.equal(prompts.length, 1);
  });
});

describe("when the LLM is down", () => {
  test("summaries pause after 5 failures in a row, so an outage costs 5 calls, then resume", async () => {
    for (let i = 0; i < 8; i++) await trackWithTaglineChange(`competitor-${i}`);
    let time = Date.now();
    const service = createSummaryService({ data: services.data, llm, dailyCap: 100, log: silent, now: () => new Date(time) });
    answers = Array.from({ length: 8 }, (): CompletionResult => ({ kind: "failed", error: "HTTP 503" }));

    for (let ids = await service.claimDue(1, []); ids.length > 0; ids = await service.claimDue(1, [])) {
      for (const id of ids) await service.summarizeSnapshot(id);
    }
    assert.equal(prompts.length, 5);
    assert.equal(await llmUsageRepository.findCallsToday(), 5);

    answers = [];
    time += 5 * MINUTE_MS;
    const trial = await service.claimDue(4, []);
    assert.equal(trial.length, 1);
    await service.summarizeSnapshot(trial[0]!);
    assert.equal((await reload(Number(trial[0]))).summaryStatus, "summarized");
    assert.equal((await service.claimDue(4, [])).length, 2);
  });
});

describe("GET /api/competitors/:id/snapshots", () => {
  test("exposes the summary, its status, retry time and the old → new changes", async () => {
    const changed = await trackWithTaglineChange();
    answers.push({ kind: "timeout" });
    await summaryService().summarizeSnapshot(String(changed.id));

    const [newest] = (await app.inject({ method: "GET", url: "/api/competitors/acme-crm/snapshots" })).json();
    assert.equal(newest.summary, null);
    assert.equal(newest.summaryStatus, "llm_timeout");
    assert.equal(newest.summaryAttempts, 1);
    assert.equal(typeof newest.summaryRetryAt, "string");
    assert.deepEqual(newest.changes, [{ field: "tagline", before: "Simple CRM for small teams", after: "The CRM small teams love" }]);
    assert.equal(newest.summarySource, null);
  });
});
