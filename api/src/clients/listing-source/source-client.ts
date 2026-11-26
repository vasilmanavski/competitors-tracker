import { setTimeout as sleep } from "node:timers/promises";
import type { RateLimiter } from "./rate-limiter.ts";

/** What the rest of the system gets back from one poll of the source. */
export type FetchResult =
  | { kind: "ok"; body: unknown }
  | { kind: "not_found" }
  | { kind: "failed"; error: string; attempts: number };

/** What a single HTTP request told us. */
type SingleResponse =
  | { kind: "ok"; body: unknown }
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "transient_error"; error: string }
  | { kind: "permanent_error"; error: string };

export type SourceClientOptions = {
  baseUrl: string;
  limiter: RateLimiter;
  /** Per attempt, covering the whole exchange including the body. */
  timeoutMs: number;
  /** Extra attempts after a transient error (5xx, timeout, network, invalid JSON). */
  maxRetries: number;
  backoffMs?: number;
  /** Stops one poll from waiting on 429s forever. */
  max429Retries?: number;
  maxRetryAfterMs?: number;
  fetchImpl?: typeof fetch;
};

/** Fetches listings from the source; every failure comes back as a value, never as an exception. */
export type SourceClient = {
  fetchListing(id: string, signal?: AbortSignal): Promise<FetchResult>;
};

const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_429_RETRIES = 30;
const DEFAULT_MAX_RETRY_AFTER_MS = 120_000;
const RETRY_AFTER_FALLBACK_MS = 1000;
const BACKOFF_FACTOR = 3;
const JITTER = 0.25;

/** Retry-After is either delay-seconds or an HTTP date (RFC 9110). */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Maps one HTTP response to what the retry policy should do with it. */
export function classifyResponse(status: number, retryAfter: string | null, bodyText: string): SingleResponse {
  if (status === 404) return { kind: "not_found" };
  if (status === 429) {
    return { kind: "rate_limited", retryAfterMs: parseRetryAfter(retryAfter) ?? RETRY_AFTER_FALLBACK_MS };
  }
  if (status >= 500) return { kind: "transient_error", error: `HTTP ${status}` };
  if (status < 200 || status >= 300) return { kind: "permanent_error", error: `HTTP ${status}` };

  try {
    return { kind: "ok", body: JSON.parse(bodyText) as unknown };
  } catch {
    return { kind: "transient_error", error: "response was not valid JSON" };
  }
}

/** Exponential backoff (500 ms, 1.5 s, 4.5 s …) with ±25% jitter. `failedAttempts` starts at 1. */
export function backoffDelayMs(failedAttempts: number, baseMs: number, random = Math.random): number {
  const exponential = baseMs * BACKOFF_FACTOR ** (failedAttempts - 1);
  const jitter = 1 - JITTER + random() * 2 * JITTER;
  return exponential * jitter;
}

function describeError(err: unknown, timeoutMs: number): string {
  if (!(err instanceof Error)) return `network error: ${String(err)}`;
  if (err.name === "TimeoutError") return `timeout after ${timeoutMs} ms`;
  const cause = err.cause as { code?: unknown; message?: unknown } | undefined;
  if (typeof cause?.code === "string") return `network error: ${cause.code}`;
  if (typeof cause?.message === "string") return `network error: ${cause.message}`;
  return `network error: ${err.message}`;
}

/** "HTTP 502 (3 attempts)" when all attempts failed alike, else "3 attempts: HTTP 503, HTTP 502, timeout after 5000 ms". */
function describeAttempts(errors: string[]): string {
  if (errors.length === 1) return `${errors[0]} (1 attempt)`;
  if (errors.every((e) => e === errors[0])) return `${errors[0]} (${errors.length} attempts)`;
  return `${errors.length} attempts: ${errors.join(", ")}`;
}

/** Creates the HTTP client for `GET {baseUrl}/listings/:id`. */
export function createSourceClient(options: SourceClientOptions): SourceClient {
  const { limiter, timeoutMs, maxRetries, fetchImpl = fetch } = options;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const max429Retries = options.max429Retries ?? DEFAULT_MAX_429_RETRIES;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;
  const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;

  /** Sends one request. Throws only when the caller aborts. */
  async function requestOnce(id: string, signal?: AbortSignal): Promise<SingleResponse> {
    const url = new URL(`listings/${encodeURIComponent(id)}`, baseUrl);
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const bodyText = await res.text();
      return classifyResponse(res.status, res.headers.get("retry-after"), bodyText);
    } catch (err) {
      if (signal?.aborted) throw err;
      return { kind: "transient_error", error: describeError(err, timeoutMs) };
    }
  }

  /**
   * Fetches one listing with two retry budgets: a 429 pauses the shared limiter for
   * Retry-After and asks again (not counted as a failed attempt); a transient error
   * backs off and retries up to `maxRetries`.
   */
  async function fetchListing(id: string, signal?: AbortSignal): Promise<FetchResult> {
    const failures: string[] = [];
    let rateLimitedCount = 0;

    while (true) {
      await limiter.acquire(signal);
      const response = await requestOnce(id, signal);

      switch (response.kind) {
        case "ok":
        case "not_found":
          return response;

        case "permanent_error":
          return { kind: "failed", error: response.error, attempts: failures.length + 1 };

        case "rate_limited":
          limiter.pauseFor(Math.min(response.retryAfterMs, maxRetryAfterMs));
          rateLimitedCount++;
          if (rateLimitedCount > max429Retries) {
            const error = `still rate limited after ${rateLimitedCount} tries`;
            return { kind: "failed", error, attempts: failures.length };
          }
          break;

        case "transient_error":
          failures.push(response.error);
          if (failures.length > maxRetries) {
            return { kind: "failed", error: describeAttempts(failures), attempts: failures.length };
          }
          await sleep(backoffDelayMs(failures.length, backoffMs), undefined, { signal });
          break;
      }
    }
  }

  return { fetchListing };
}
