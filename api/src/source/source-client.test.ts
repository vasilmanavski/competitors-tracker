// The client against a scripted local HTTP server that misbehaves like the source.
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { createRateLimiter } from "./rate-limiter.ts";
import { backoffDelayMs, classifyResponse, createSourceClient, parseRetryAfter } from "./source-client.ts";

type Step = (res: ServerResponse) => void;
let script: Step[] = [];
let requests = 0;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Step => (res) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const html502: Step = (res) => {
  res.writeHead(502, { "content-type": "text/html" });
  res.end("<html><body><h1>502 Bad Gateway</h1></body></html>");
};
const hang: Step = () => {}; // never answers
const listing = { title: "Acme CRM", requestId: "x" };

const server = createServer((_req, res) => {
  requests++;
  (script.shift() ?? json(500, { error: "script exhausted" }))(res);
});
let baseUrl = "";

const client = (overrides: { maxRetries?: number } = {}) =>
  createSourceClient({
    baseUrl,
    limiter: createRateLimiter(1000),
    timeoutMs: 150,
    maxRetries: overrides.maxRetries ?? 2,
    backoffMs: 5,
  });

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  script = [];
  requests = 0;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

describe("source client", () => {
  test("200 → ok with the parsed body", async () => {
    script = [json(200, listing)];
    assert.deepEqual(await client().fetchListing("acme-crm"), { kind: "ok", body: listing });
  });

  test("404 → not_found, no retry", async () => {
    script = [json(404, { error: "not_found" })];
    assert.deepEqual(await client().fetchListing("nope"), { kind: "not_found" });
    assert.equal(requests, 1);
  });

  test("5xx (incl. HTML body) then 200 → retried, ok", async () => {
    script = [json(503, { error: "service_unavailable" }), html502, json(200, listing)];
    assert.equal((await client().fetchListing("acme-crm")).kind, "ok");
    assert.equal(requests, 3);
  });

  test("5xx on every attempt → failed after 1 + maxRetries attempts", async () => {
    script = [html502, html502, html502];
    assert.deepEqual(await client().fetchListing("acme-crm"), {
      kind: "failed",
      error: "HTTP 502 (3 attempts)",
      attempts: 3,
    });
  });

  test("mixed failures → every attempt's error, in order", async () => {
    script = [json(503, {}), html502, hang];
    const result = await client().fetchListing("acme-crm");
    assert.deepEqual(result, {
      kind: "failed",
      error: "3 attempts: HTTP 503, HTTP 502, timeout after 150 ms",
      attempts: 3,
    });
  });

  test("no response → timeout, then retried", async () => {
    script = [hang, json(200, listing)];
    assert.equal((await client().fetchListing("acme-crm")).kind, "ok");
  });

  test("timeouts on every attempt → failed with the timeout in the error", async () => {
    script = [hang];
    const result = await client({ maxRetries: 0 }).fetchListing("acme-crm");
    assert.deepEqual(result, { kind: "failed", error: "timeout after 150 ms (1 attempt)", attempts: 1 });
  });

  test("200 with a non-JSON body → retryable", async () => {
    script = [
      (res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{not json");
      },
      json(200, listing),
    ];
    assert.equal((await client().fetchListing("acme-crm")).kind, "ok");
  });

  test("429 → waits Retry-After, retries; 429s don't use up the retry budget", async () => {
    script = [json(429, { error: "rate_limited" }, { "retry-after": "0.2" }), json(200, listing)];
    const started = Date.now();
    const result = await client({ maxRetries: 0 }).fetchListing("acme-crm");
    assert.equal(result.kind, "ok");
    assert.ok(Date.now() - started >= 190, "waited for Retry-After");
  });

  test("other 4xx → failed immediately", async () => {
    script = [json(400, { error: "bad" })];
    assert.deepEqual(await client().fetchListing("acme-crm"), { kind: "failed", error: "HTTP 400", attempts: 1 });
  });

  test("connection refused → failed with a network error", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    const c = createSourceClient({
      baseUrl: `http://127.0.0.1:${port}`,
      limiter: createRateLimiter(1000),
      timeoutMs: 500,
      maxRetries: 0,
    });
    const result = await c.fetchListing("acme-crm");
    assert.equal(result.kind, "failed");
    assert.match((result as { error: string }).error, /network error: ECONNREFUSED/);
  });

  test("caller abort (shutdown) throws instead of returning a result", async () => {
    script = [hang];
    const controller = new AbortController();
    const pending = client().fetchListing("acme-crm", controller.signal);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending);
  });
});

describe("parseRetryAfter", () => {
  test("seconds, HTTP date, missing, garbage", () => {
    assert.equal(parseRetryAfter("2"), 2000);
    assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT", 0), 5000);
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter("soon"), null);
  });
});

describe("classifyResponse", () => {
  test("maps each status class to what the retry policy should do", () => {
    assert.deepEqual(classifyResponse(200, null, '{"title":"Acme"}'), { kind: "ok", body: { title: "Acme" } });
    assert.deepEqual(classifyResponse(404, null, ""), { kind: "not_found" });
    assert.deepEqual(classifyResponse(429, "2", ""), { kind: "rate_limited", retryAfterMs: 2000 });
    assert.deepEqual(classifyResponse(429, null, ""), { kind: "rate_limited", retryAfterMs: 1000 });
    assert.deepEqual(classifyResponse(503, null, "<html>"), { kind: "transient_error", error: "HTTP 503" });
    assert.deepEqual(classifyResponse(400, null, ""), { kind: "permanent_error", error: "HTTP 400" });
    assert.deepEqual(classifyResponse(200, null, "<html>"), {
      kind: "transient_error",
      error: "response was not valid JSON",
    });
  });
});

describe("backoffDelayMs", () => {
  test("triples each attempt, with ±25% jitter", () => {
    const noJitter = () => 0.5;
    assert.equal(backoffDelayMs(1, 500, noJitter), 500);
    assert.equal(backoffDelayMs(2, 500, noJitter), 1500);
    assert.equal(backoffDelayMs(3, 500, noJitter), 4500);
    assert.equal(backoffDelayMs(1, 500, () => 0), 375);
    assert.equal(backoffDelayMs(1, 500, () => 1), 625);
  });
});
