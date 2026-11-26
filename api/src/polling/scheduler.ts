export type SchedulerLogger = { error(obj: object, msg: string): void };

export type SchedulerOptions = {
  claimDue: (limit: number, excludeIds: string[]) => Promise<string[]>;
  runJob: (id: string, signal: AbortSignal) => Promise<void>;
  maxInFlight: number;
  tickMs?: number;
  log: SchedulerLogger;
};

const DEFAULT_TICK_MS = 1000;

/**
 * Runs background jobs (polls, summaries). Each tick claims due work and starts the
 * jobs without waiting for them; the next tick is scheduled only after the claim
 * finished, so ticks never overlap. At most `maxInFlight` jobs run at once, and a
 * failing job is logged without affecting the others.
 */
export function createScheduler(options: SchedulerOptions) {
  const { claimDue, runJob, maxInFlight, tickMs = DEFAULT_TICK_MS, log } = options;
  const inFlight = new Map<string, Promise<void>>();
  const shutdown = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let currentTick: Promise<void> | undefined;

  function startJob(id: string): void {
    const running = runJob(id, shutdown.signal)
      .catch((err: unknown) => {
        if (!shutdown.signal.aborted) log.error({ err, jobId: id }, "job crashed");
      })
      .finally(() => inFlight.delete(id));
    inFlight.set(id, running);
  }

  async function tick(): Promise<void> {
    try {
      const ids = await claimDue(maxInFlight - inFlight.size, [...inFlight.keys()]);
      ids.forEach(startJob);
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

    /** Stops claiming, aborts in-flight jobs and waits for them to settle. */
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
