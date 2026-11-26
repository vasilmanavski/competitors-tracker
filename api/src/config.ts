import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),

  SOURCE_BASE_URL: z.url(),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),
  /** Our pace for all source requests; 4/s leaves headroom under the source's 5/s. */
  SOURCE_RATE_LIMIT_PER_SECOND: z.coerce.number().positive().default(4),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SOURCE_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  /** Set to false to run the API without background work (polling and summaries). */
  SCHEDULER_ENABLED: z.stringbool().default(true),

  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1).default("not-needed-for-mock"),
  LLM_MODEL: z.string().min(1).default("mock-model"),
  /** Hard cap on LLM calls per UTC day, across all competitors and instances. */
  LLM_DAILY_CAP: z.coerce.number().int().nonnegative().default(2000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Reads and validates the configuration from env vars.
 * @throws Error listing every invalid variable, so a bad deploy fails at startup
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid configuration:\n${problems}`);
}
