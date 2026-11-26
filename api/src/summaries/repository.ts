import { sql } from "drizzle-orm";
import type { DbExecutor } from "../db/client.ts";
import { llmUsage } from "../db/schema.ts";

const UTC_TODAY = sql`(now() at time zone 'utc')::date`;

/** SQL access to the `llm_usage` table: LLM calls counted per UTC day. */
export function createLlmUsageRepository(db: DbExecutor) {
  return {
    /**
     * Counts one call for today if that stays within `cap`, in a single statement, so
     * concurrent workers and instances can never exceed the cap together.
     * @returns false when today's cap is already used up
     */
    async incrementCallsIfBelow(cap: number): Promise<boolean> {
      if (cap <= 0) return false;
      const result = await db.execute(sql`
        insert into ${llmUsage} (day, calls) values (${UTC_TODAY}, 1)
        on conflict (day) do update set calls = ${llmUsage.calls} + 1
        where ${llmUsage.calls} < ${cap}
        returning calls`);
      return result.rows.length > 0;
    },

    async findCallsToday(): Promise<number> {
      const result = await db.execute<{ calls: number }>(sql`select calls from ${llmUsage} where day = ${UTC_TODAY}`);
      return result.rows[0]?.calls ?? 0;
    },
  };
}

export type LlmUsageRepository = ReturnType<typeof createLlmUsageRepository>;
