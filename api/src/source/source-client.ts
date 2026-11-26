import { setTimeout as sleep } from "node:timers/promises";
import type { RateLimiter } from "./rate-limiter.ts";

// HTTP client for the listing source. It treats the source as an unreliable
// third-party website and turns every way a request can go wrong into a plain
// result value. The only thing it throws is an abort from the caller (shutdown).

export type FetchResult =
  | { kind: "ok"; body: unknown }
  | { kind: "not_found" }
  | { kind: "failed"; error: string; attempts: number };

type Attempt =
  | FetchResult
  | { kind: "retryable"; error: string }
  | { kind: "rate_limited"; retryAfterMs: number };

export type SourceClientOptions = {
  baseUrl: string;
  limiter: RateLimiter;
  timeoutMs: number; // per attempt (decision 2.9)
  maxRetries: number; // extra attempts after 5xx / timeout / network / non-JSON
  backoffMs?: number; // first retry delay; tripled each time, plus jitter
  max429Retries?: number; // safety net so one poll can't loop forever
  maxRetryAfterMs?: number; // cap on a Retry-After we are willing to honour
  fetchImpl?: typeof fetch;
};

export type SourceClient = {
  fetchListing(id: string, signal?: AbortSignal): Promise<FetchResult>;
};

// Retry-After is either delay-seconds or an HTTP date (RFC 9110).
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function describeError(err: unknown, timeoutMs: number): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return `timeout after ${timeoutMs} ms`;
    const cause = err.cause as { code?: unknown; message?: unknown } | undefined;
    const detail = typeof cause?.code === "string" ? cause.code : typeof cause?.message === "string" ? cause.message : err.message;
    return `network error: ${detail}`;
  }
  return `network error: ${String(err)}`;
}

// "HTTP 502 (3 attempts)" when every attempt failed the same way, otherwise
// each attempt in order: "3 attempts: HTTP 503, HTTP 503, timeout after 5000 ms".
function describeAttempts(errors: string[]): string {
  if (errors.length === 1) return `${errors[0]} (1 attempt)`;
  if (errors.every((e) => e === errors[0])) return `${errors[0]} (${errors.length} attempts)`;
  return `${errors.length} attempts: ${errors.join(", ")}`;
}

export function createSourceClient(options: SourceClientOptions): SourceClient {
  const {
    limiter,
    timeoutMs,
    maxRetries,
    backoffMs = 500,
    max429Retries = 30,
    maxRetryAfterMs = 120_000,
    fetchImpl = fetch,
  } = options;
  const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;

  async function attempt(id: string, signal?: AbortSignal): Promise<Attempt> {
    const url = new URL(`listings/${encodeURIComponent(id)}`, base);
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      // The timeout covers the whole exchange, body included: the source can
      // send headers and then stall, or never answer at all.
      const res = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const text = await res.text();

      if (res.status === 404) return { kind: "not_found" };
      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after")) ?? 1000;
        return { kind: "rate_limited", retryAfterMs: Math.min(retryAfterMs, maxRetryAfterMs) };
      }
      if (res.status >= 500) return { kind: "retryable", error: `HTTP ${res.status}` };
      if (!res.ok) return { kind: "failed", error: `HTTP ${res.status}`, attempts: 1 };

      try {
        return { kind: "ok", body: JSON.parse(text) as unknown };
      } catch {
        return { kind: "retryable", error: "response was not valid JSON" };
      }
    } catch (err) {
      if (signal?.aborted) throw err; // shutdown: let the caller drop this poll
      return { kind: "retryable", error: describeError(err, timeoutMs) };
    }
  }

  return {
    async fetchListing(id, signal) {
      let attempts = 0;
      let rateLimited = 0;
      const errors: string[] = [];
      for (;;) {
        await limiter.acquire(signal);
        const result = await attempt(id, signal);

        if (result.kind === "rate_limited") {
          // Not counted as a failed attempt: the request was refused, not broken.
          limiter.pauseFor(result.retryAfterMs);
          if (++rateLimited > max429Retries) {
            return { kind: "failed", error: `still rate limited after ${rateLimited} tries`, attempts };
          }
          continue;
        }

        attempts++;
        if (result.kind === "retryable") {
          errors.push(result.error);
          if (attempts > maxRetries) return { kind: "failed", error: describeAttempts(errors), attempts };
          const delay = backoffMs * 3 ** (attempts - 1) * (0.75 + Math.random() * 0.5);
          await sleep(delay, undefined, { signal });
          continue;
        }
        return result.kind === "failed" ? { ...result, attempts } : result;
      }
    },
  };
}
