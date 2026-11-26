import { loadConfig } from "./config.ts";
import { createDb, runMigrations, waitForDb } from "./db/client.ts";
import { buildApp } from "./app.ts";

async function main() {
  const config = loadConfig();
  const { pool, db } = createDb(config.DATABASE_URL);

  await waitForDb(pool);
  await runMigrations(db);
  console.log("Migrations applied");

  const app = buildApp({ db });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
