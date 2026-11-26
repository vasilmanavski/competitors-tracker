import { buildApp } from "./app.ts";
import { type Config, loadConfig } from "./config.ts";
import { createDb, runMigrations, waitForDb } from "./db/client.ts";
import { createPollingService, type PollLogger } from "./polling/service.ts";
import { createScheduler, type Scheduler, type SchedulerLogger } from "./polling/scheduler.ts";
import { createServices, type Services } from "./services.ts";
import { createRateLimiter } from "./source/rate-limiter.ts";
import { createSourceClient } from "./source/source-client.ts";

/**
 * Enough concurrent polls to keep the rate limiter busy while responses are slow
 * (rate × timeout), but bounded so one tick never claims the whole backlog.
 */
function maxPollsInFlight(config: Config): number {
  return Math.max(1, Math.ceil(config.SOURCE_RATE_LIMIT_PER_SECOND * (config.SOURCE_TIMEOUT_MS / 1000)));
}

function createPollingScheduler(config: Config, services: Services, log: PollLogger & SchedulerLogger): Scheduler {
  const source = createSourceClient({
    baseUrl: config.SOURCE_BASE_URL,
    limiter: createRateLimiter(config.SOURCE_RATE_LIMIT_PER_SECOND),
    timeoutMs: config.SOURCE_TIMEOUT_MS,
    maxRetries: config.SOURCE_MAX_RETRIES,
  });
  const polling = createPollingService({
    source,
    snapshots: services.snapshots,
    competitors: services.data.repositories.competitors,
    intervalSeconds: config.POLL_INTERVAL_SECONDS,
    log,
  });
  return createScheduler({
    claimDue: polling.claimDue,
    poll: polling.pollCompetitor,
    maxInFlight: maxPollsInFlight(config),
    log,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { pool, db } = createDb(config.DATABASE_URL);
  await waitForDb(pool);
  await runMigrations(db);

  const services = createServices(db);
  const app = buildApp(services);
  const scheduler = createPollingScheduler(config, services, app.log.child({ component: "poller" }));

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await scheduler.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.PORT });

  if (!config.SCHEDULER_ENABLED) {
    app.log.warn("SCHEDULER_ENABLED=false: not polling the source");
    return;
  }
  scheduler.start();
  app.log.info(
    { source: config.SOURCE_BASE_URL, intervalSeconds: config.POLL_INTERVAL_SECONDS, ratePerSecond: config.SOURCE_RATE_LIMIT_PER_SECOND },
    "scheduler started",
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
