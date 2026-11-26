import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CompetitorAlreadyTrackedError, CompetitorNotTrackedError } from "./errors.ts";
import type { Competitor, CompetitorRepository } from "./repository.ts";
import { createCompetitorService } from "./service.ts";

const NOW = new Date("2026-11-26T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

function competitor(patch: Partial<Competitor> = {}): Competitor {
  return {
    id: "acme-crm",
    createdAt: hoursAgo(100),
    nextPollAt: NOW,
    lastPolledAt: null,
    lastStatus: null,
    lastChangedAt: null,
    listingState: "unknown",
    ...patch,
  };
}

function serviceWith(repository: Partial<CompetitorRepository>) {
  return createCompetitorService({ competitors: repository as CompetitorRepository, now: () => NOW });
}

describe("CompetitorService", () => {
  test("list flags competitors that changed in the last 24 hours", async () => {
    const service = serviceWith({
      list: async () => [
        competitor({ id: "recent", lastChangedAt: hoursAgo(23) }),
        competitor({ id: "old", lastChangedAt: hoursAgo(25) }),
        competitor({ id: "never" }),
      ],
    });
    const flags = (await service.list()).map((c) => [c.id, c.changedLast24h]);
    assert.deepEqual(flags, [["recent", true], ["old", false], ["never", false]]);
  });

  test("list flags competitors the source has never listed", async () => {
    const service = serviceWith({ list: async () => [competitor({ listingState: "never_listed" })] });
    assert.equal((await service.list())[0]?.neverFound, true);
  });

  test("add rejects an id that is already tracked", async () => {
    const service = serviceWith({ create: async () => null });
    await assert.rejects(service.add("acme-crm"), CompetitorAlreadyTrackedError);
  });

  test("remove rejects an id that is not tracked", async () => {
    const service = serviceWith({ remove: async () => false });
    await assert.rejects(service.remove("acme-crm"), CompetitorNotTrackedError);
  });
});
