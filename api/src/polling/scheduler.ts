import type { SnapshotRepository } from "../snapshots/repository.ts";

// Decision 2.10: a self-rescheduling setTimeout tick. A tick only claims work
// and starts polls; it never waits for them, and the next tick is scheduled
// only after this one's claim query finished, so ticks never overlap.
//
// At most `maxInFlight` polls run at once. Polls themselves are paced by the
// global rate limiter, so maxInFlight only needs to cover the requests that
// are in the air or waiting for a slot. It also stops us from claiming the
// whole table when we're behind: unclaimed rows simply stay due.

export type SchedulerLogger = { error(obj: object, msg: string): void };

export type SchedulerOptions = {
  snapshots: Pick<SnapshotRepository, "claimDue">;
  poll: (competitorId: string, signal: AbortSignal) => Promise<void>;
  intervalSeconds: number;
  maxInFlight: number;
  tickMs?: number;
  log: SchedulerLogger;
};

export function createScheduler(options: SchedulerOptions) {
  const { snapshots, poll, intervalSeconds, maxInFlight, tickMs = 1000, log } = options;
  const inFlight = new Map<string, Promise<void>>();
  const shutdown = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let tickRunning: Promise<void> | undefined;

  function startPoll(id: string) {
    // Decision 2.11: each poll is isolated. Whatever it throws is logged and
    // forgotten; the scheduler and the other polls carry on.
    const running = poll(id, shutdown.signal)
      .catch((err: unknown) => {
        if (shutdown.signal.aborted) return; // dropped on shutdown; polled again at its next due time
        log.error({ err, competitorId: id }, "poll crashed");
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, running);
  }

  async function tick() {
    try {
      const room = maxInFlight - inFlight.size;
      // Excluding in-flight ids guards against a poll that outlives the interval
      // (e.g. a long 429 pause with a short dev interval).
      const ids = await snapshots.claimDue(room, intervalSeconds, [...inFlight.keys()]);
      for (const id of ids) startPoll(id);
    } catch (err) {
      log.error({ err }, "scheduler tick failed; retrying next tick");
    }
  }

  function schedule(delay: number) {
    if (shutdown.signal.aborted) return;
    timer = setTimeout(() => {
      tickRunning = tick().finally(() => schedule(tickMs));
    }, delay);
  }

  return {
    start() {
      schedule(0);
    },
    // Stop claiming, abort in-flight polls (they write nothing), wait for them.
    async stop() {
      shutdown.abort();
      clearTimeout(timer);
      await tickRunning;
      await Promise.allSettled(inFlight.values());
    },
    get inFlight() {
      return inFlight.size;
    },
  };
}
