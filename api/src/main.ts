import { loadConfig } from "./config.ts";
import { createDb, runMigrations, waitForDb } from "./db/client.ts";
import { buildApp } from "./app.ts";
import { createPoller } from "./polling/poller.ts";
import { createScheduler } from "./polling/scheduler.ts";
import { snapshotRepository } from "./snapshots/repository.ts";
import { createRateLimiter } from "./source/rate-limiter.ts";
import { createSourceClient } from "./source/source-client.ts";

async function main() {
  const config = loadConfig();
  const { pool, db } = createDb(config.DATABASE_URL);

  await waitForDb(pool);
  await runMigrations(db);
  console.log("Migrations applied");

  const app = buildApp({ db });

  // Polling runs in the API process: one global limiter for every request to
  // the source (decision 2.7). Epic 4 describes splitting it out at scale.
  const limiter = createRateLimiter(config.SOURCE_RATE_LIMIT_PER_SECOND);
  const source = createSourceClient({
    baseUrl: config.SOURCE_BASE_URL,
    limiter,
    timeoutMs: config.SOURCE_TIMEOUT_MS,
    maxRetries: config.SOURCE_MAX_RETRIES,
  });
  const log = app.log.child({ component: "poller" });
  const scheduler = createScheduler({
    snapshots: snapshotRepository(db),
    poll: createPoller({ source, snapshots: snapshotRepository(db), log }),
    intervalSeconds: config.POLL_INTERVAL_SECONDS,
    // Enough concurrency to keep the limiter busy through slow responses
    // (rate × timeout), but bounded so we never claim the whole backlog.
    maxInFlight: Math.max(1, Math.ceil(config.SOURCE_RATE_LIMIT_PER_SECOND * (config.SOURCE_TIMEOUT_MS / 1000))),
    log,
  });

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

  if (config.SCHEDULER_ENABLED) {
    scheduler.start();
    app.log.info(
      { source: config.SOURCE_BASE_URL, intervalSeconds: config.POLL_INTERVAL_SECONDS, ratePerSecond: config.SOURCE_RATE_LIMIT_PER_SECOND },
      "scheduler started",
    );
  } else {
    app.log.warn("SCHEDULER_ENABLED=false: not polling the source");
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
