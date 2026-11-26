export type SchedulerLogger = { error(obj: object, msg: string): void };

export type SchedulerOptions = {
  claimDue: (limit: number, excludeIds: string[]) => Promise<string[]>;
  poll: (competitorId: string, signal: AbortSignal) => Promise<void>;
  maxInFlight: number;
  tickMs?: number;
  log: SchedulerLogger;
};

const DEFAULT_TICK_MS = 1000;

/**
 * Runs polls in the background. Each tick claims due competitors and starts their
 * polls without waiting for them; the next tick is scheduled only after the claim
 * finished, so ticks never overlap. At most `maxInFlight` polls run at once, and a
 * failing poll is logged without affecting the others.
 */
export function createScheduler(options: SchedulerOptions) {
  const { claimDue, poll, maxInFlight, tickMs = DEFAULT_TICK_MS, log } = options;
  const inFlight = new Map<string, Promise<void>>();
  const shutdown = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let currentTick: Promise<void> | undefined;

  function startPoll(id: string): void {
    const running = poll(id, shutdown.signal)
      .catch((err: unknown) => {
        if (!shutdown.signal.aborted) log.error({ err, competitorId: id }, "poll crashed");
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, running);
  }

  async function tick(): Promise<void> {
    try {
      const ids = await claimDue(maxInFlight - inFlight.size, [...inFlight.keys()]);
      ids.forEach(startPoll);
    } catch (err) {
      log.error({ err }, "scheduler tick failed; retrying next tick");
    }
  }

  function scheduleTick(delayMs: number): void {
    if (shutdown.signal.aborted) return;
    timer = setTimeout(() => {
      currentTick = tick().finally(() => scheduleTick(tickMs));
    }, delayMs);
  }

  return {
    start(): void {
      scheduleTick(0);
    },

    /** Stops claiming, aborts in-flight polls (they store nothing) and waits for them to settle. */
    async stop(): Promise<void> {
      shutdown.abort();
      clearTimeout(timer);
      await currentTick;
      await Promise.allSettled(inFlight.values());
    },

    get inFlight(): number {
      return inFlight.size;
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
