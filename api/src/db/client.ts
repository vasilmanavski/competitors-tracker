import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>["db"];

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

// Compose already waits for Postgres to be healthy, but the API should not
// depend on that: outside compose (or on a DB restart) we retry for a while.
export async function waitForDb(pool: pg.Pool, attempts = 30, delayMs = 1000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.warn(`Database not ready (attempt ${attempt}/${attempts}), retrying in ${delayMs} ms`);
      await sleep(delayMs);
    }
  }
}

// Applies every pending SQL file in ./drizzle and records it in
// drizzle.__drizzle_migrations. This is the only code that changes the schema.
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
