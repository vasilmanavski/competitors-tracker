import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Clock, createRateLimiter } from "./rate-limiter.ts";

// A virtual clock: sleep() resolves when advance() moves time past its deadline.
function fakeClock() {
  let time = 1_000_000;
  const sleepers: { at: number; resolve: () => void }[] = [];
  const clock: Clock = {
    now: () => time,
    sleep: (ms) => new Promise((resolve) => sleepers.push({ at: time + ms, resolve })),
  };
  async function advance(ms: number) {
    const end = time + ms;
    for (;;) {
      sleepers.sort((a, b) => a.at - b.at);
      const next = sleepers[0];
      if (!next || next.at > end) break;
      sleepers.shift();
      time = next.at;
      next.resolve();
      await new Promise((r) => setImmediate(r)); // let the woken caller run
    }
    time = end;
  }
  return { clock, advance, now: () => time };
}

describe("rate limiter", () => {
  test("spaces requests 1000/rate ms apart, no burst", async () => {
    const { clock, advance, now } = fakeClock();
    const limiter = createRateLimiter(4, clock);
    const start = now();
    const startedAt: number[] = [];
    const callers = Array.from({ length: 5 }, () => limiter.acquire().then(() => startedAt.push(now() - start)));
    await new Promise((r) => setImmediate(r)); // the first caller needs no wait
    await advance(2000);
    await Promise.all(callers);
    assert.deepEqual(startedAt, [0, 250, 500, 750, 1000]);
  });

  test("pauseFor holds back every caller, including ones already queued", async () => {
    const { clock, advance, now } = fakeClock();
    const limiter = createRateLimiter(4, clock);
    const start = now();
    await limiter.acquire(); // t=0
    const startedAt: number[] = [];
    const queued = [limiter.acquire(), limiter.acquire()].map((p) => p.then(() => startedAt.push(now() - start)));
    limiter.pauseFor(1000); // e.g. a 429 with Retry-After: 1
    await advance(3000);
    await Promise.all(queued);
    assert.ok(startedAt.every((t) => t >= 1000), `started at ${startedAt}`);
    assert.ok(startedAt[1]! - startedAt[0]! >= 250, `spacing kept after the pause: ${startedAt}`);
  });

  test("an aborted caller rejects", async () => {
    const limiter = createRateLimiter(1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(limiter.acquire(controller.signal));
  });
});
