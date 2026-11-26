import { setTimeout as sleep } from "node:timers/promises";

/** Paces every request to the source, because the source's rate limit is global across ids. */
export type RateLimiter = {
  /** Resolves when the caller may send one request. */
  acquire(signal?: AbortSignal): Promise<void>;
  /** Holds back every caller for `ms`, e.g. for a 429's Retry-After. */
  pauseFor(ms: number): void;
};

/** Time source, replaceable in tests. */
export type Clock = {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => sleep(ms, undefined, { signal }),
};

/**
 * A token bucket with capacity 1: requests start at least `1000 / rate` ms apart and
 * never burst, since bursts are what trip the source's own limiter. Slots are reserved
 * synchronously, so concurrent callers are served in order.
 */
export function createRateLimiter(ratePerSecond: number, clock: Clock = realClock): RateLimiter {
  if (!(ratePerSecond > 0)) throw new Error("ratePerSecond must be > 0");
  const spacingMs = 1000 / ratePerSecond;
  let nextSlotAt = 0;
  let pausedUntil = 0;

  return {
    async acquire(signal) {
      for (;;) {
        signal?.throwIfAborted();
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
