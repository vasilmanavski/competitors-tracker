import { z } from "zod";
import type { ChatMessage } from "./prompt.ts";

/** What one completion request produced. Only a caller abort is thrown. */
export type CompletionResult =
  | { kind: "answer"; content: string | null; finishReason: string | null }
  | { kind: "timeout" }
  | { kind: "failed"; error: string }
  | { kind: "malformed"; reason: string };

export type LlmClientOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
};

export type LlmClient = {
  complete(messages: ChatMessage[], signal?: AbortSignal): Promise<CompletionResult>;
};

const DEFAULT_MAX_TOKENS = 150;
const TEMPERATURE = 0.2;
const MAX_ERROR_BODY_CHARS = 200;

const CompletionResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

function parseCompletion(text: string): CompletionResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "malformed", reason: "response was not valid JSON" };
  }
  const parsed = CompletionResponse.safeParse(json);
  if (!parsed.success) return { kind: "malformed", reason: "response did not have the chat completion shape" };
  const [choice] = parsed.data.choices;
  return { kind: "answer", content: choice?.message.content ?? null, finishReason: choice?.finish_reason ?? null };
}

function describeNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return `network error: ${String(err)}`;
  const cause = err.cause as { code?: unknown } | undefined;
  return `network error: ${typeof cause?.code === "string" ? cause.code : err.message}`;
}

/**
 * A client for any OpenAI-compatible Chat Completions endpoint (the mock, OpenAI,
 * Ollama, ...). One request per call, no retries: retrying is the caller's policy.
 */
export function createLlmClient(options: LlmClientOptions): LlmClient {
  const { apiKey, model, timeoutMs, maxTokens = DEFAULT_MAX_TOKENS, fetchImpl = fetch } = options;
  const url = new URL("chat/completions", options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);

  return {
    async complete(messages, signal) {
      const timeout = AbortSignal.timeout(timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: TEMPERATURE }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const text = await res.text();
        if (!res.ok) return { kind: "failed", error: `HTTP ${res.status}: ${text.slice(0, MAX_ERROR_BODY_CHARS)}` };
        return parseCompletion(text);
      } catch (err) {
        if (signal?.aborted) throw err;
        if (timeout.aborted) return { kind: "timeout" };
        return { kind: "failed", error: describeNetworkError(err) };
      }
    },
  };
}
