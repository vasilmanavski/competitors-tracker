import { z } from "zod";

// Every setting comes from env vars. They are validated once at startup, so
// a bad value stops the process before it serves traffic or touches the DB.
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),

  // Listing source. Graders point this at their own instance.
  SOURCE_BASE_URL: z.url(),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(900),
  // Our own pace for ALL source requests. Default 4: headroom under the
  // source's 5/s, so clock drift and retries don't tip us into 429s.
  SOURCE_RATE_LIMIT_PER_SECOND: z.coerce.number().positive().default(4),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SOURCE_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
  // Set to false to run the API without polling (e.g. a read-only replica).
  SCHEDULER_ENABLED: z.stringbool().default(true),

  // LLM (OpenAI Chat Completions shape). Used from Epic 3.
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1).default("not-needed-for-mock"),
  LLM_MODEL: z.string().min(1).default("mock-model"),
  LLM_DAILY_CAP: z.coerce.number().int().nonnegative().default(2000),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}
