import { setTimeout as sleep } from "node:timers/promises";

// Decision 2.7: ONE limiter for every request to the source, because the
// source's limit is global across all ids. It is a token bucket with capacity 1:
// requests start at least 1000/rate ms apart and never burst. A larger bucket
// would get more done after idle periods, but bursts are exactly what trips
// the source's own bucket.
//
// Decision 2.8: on a 429, pauseFor(Retry-After) holds back *every* caller, not
// just the one that got the 429. Callers that already had a slot inside the
// pause re-check after waking and queue again.

export type RateLimiter = {
  acquire(signal?: AbortSignal): Promise<void>;
  pauseFor(ms: number): void;
};

export type Clock = {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => sleep(ms, undefined, { signal }),
};

export function createRateLimiter(ratePerSecond: number, clock: Clock = realClock): RateLimiter {
  if (!(ratePerSecond > 0)) throw new Error("ratePerSecond must be > 0");
  const spacingMs = 1000 / ratePerSecond;
  let nextSlotAt = 0; // earliest start time of the next request
  let pausedUntil = 0;

  return {
    async acquire(signal) {
      for (;;) {
        signal?.throwIfAborted();
        // Reserve the slot synchronously, so concurrent callers queue in order.
        const now = clock.now();
        const slot = Math.max(now, nextSlotAt, pausedUntil);
        nextSlotAt = slot + spacingMs;
        if (slot > now) await clock.sleep(slot - now, signal);
        if (clock.now() >= pausedUntil) return;
      }
    },

    pauseFor(ms) {
      pausedUntil = Math.max(pausedUntil, clock.now() + ms);
    },
  };
}
