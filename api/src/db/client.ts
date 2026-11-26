import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

const POOL_SIZE = 10;
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Creates the connection pool and the Drizzle client on top of it. */
export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: POOL_SIZE });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Either the pool or an open transaction: repositories work on both. */
export type DbExecutor = Db | Transaction;

/**
 * Waits until the database accepts connections, so the API starts cleanly even
 * when it comes up before Postgres (outside compose, or after a DB restart).
 */
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

/** Applies pending migrations from ./drizzle. The only code that changes the schema. */
export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Throws when the database is unreachable. */
export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
