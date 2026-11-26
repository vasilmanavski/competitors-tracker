import { buildApp } from "./app.ts";
import { createRateLimiter } from "./clients/listing-source/rate-limiter.ts";
import { createSourceClient } from "./clients/listing-source/source-client.ts";
import { createLlmClient } from "./clients/llm/llm-client.ts";
import { type Config, loadConfig } from "./config.ts";
import { createDb, runMigrations, waitForDb } from "./db/client.ts";
import { createScheduler, type Scheduler, type SchedulerLogger } from "./polling/scheduler.ts";
import { createPollingService, type PollLogger } from "./polling/service.ts";
import { createServices, type Services } from "./services.ts";
import { createSummaryService, type SummaryLogger } from "./summaries/service.ts";

/** Summaries in flight at once: enough to overlap slow LLM answers without flooding the provider. */
const MAX_SUMMARIES_IN_FLIGHT = 4;

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
    snapshotService: services.snapshotService,
    competitorRepository: services.data.repositories.competitorRepository,
    intervalSeconds: config.POLL_INTERVAL_SECONDS,
    log,
  });
  return createScheduler({
    claimDue: polling.claimDue,
    runJob: polling.pollCompetitor,
    maxInFlight: maxPollsInFlight(config),
    log,
  });
}

function createSummaryScheduler(config: Config, services: Services, log: SummaryLogger & SchedulerLogger): Scheduler {
  const summaries = createSummaryService({
    data: services.data,
    llm: createLlmClient({
      baseUrl: config.LLM_BASE_URL,
      apiKey: config.LLM_API_KEY,
      model: config.LLM_MODEL,
      timeoutMs: config.LLM_TIMEOUT_MS,
    }),
    dailyCap: config.LLM_DAILY_CAP,
    log,
  });
  return createScheduler({
    claimDue: summaries.claimDue,
    runJob: summaries.summarizeSnapshot,
    maxInFlight: MAX_SUMMARIES_IN_FLIGHT,
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
  const pollingScheduler = createPollingScheduler(config, services, app.log.child({ component: "poller" }));
  const summaryScheduler = createSummaryScheduler(config, services, app.log.child({ component: "summaries" }));

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await Promise.all([pollingScheduler.stop(), summaryScheduler.stop()]);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.PORT });

  if (!config.SCHEDULER_ENABLED) {
    app.log.warn("SCHEDULER_ENABLED=false: not polling the source or generating summaries");
    return;
  }
  pollingScheduler.start();
  summaryScheduler.start();
  app.log.info(
    { source: config.SOURCE_BASE_URL, intervalSeconds: config.POLL_INTERVAL_SECONDS, ratePerSecond: config.SOURCE_RATE_LIMIT_PER_SECOND },
    "polling started",
  );
  app.log.info({ llm: config.LLM_BASE_URL, model: config.LLM_MODEL, dailyCap: config.LLM_DAILY_CAP }, "summaries started");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
