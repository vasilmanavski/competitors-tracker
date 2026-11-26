import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { createLlmClient } from "./llm-client.ts";

type Responder = (req: IncomingMessage, res: ServerResponse, body: string) => void;
let respond: Responder = () => {};
let lastRequest: { url?: string; auth?: string; body: unknown } = { body: null };

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    lastRequest = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "null") };
    respond(req, res, body);
  });
});

const completion = (content: string | null, finishReason = "stop"): Responder => (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }] }));
};
const messages = [{ role: "user" as const, content: "Price: $39 → $29" }];
let baseUrl = "";
const client = () => createLlmClient({ baseUrl, apiKey: "test-key", model: "test-model", timeoutMs: 150 });

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
beforeEach(() => {
  respond = completion("Price dropped.");
});
after(() => {
  server.closeAllConnections();
  server.close();
});

describe("LLM client", () => {
  test("sends an OpenAI-shaped request and returns the answer", async () => {
    assert.deepEqual(await client().complete(messages), { kind: "answer", content: "Price dropped.", finishReason: "stop" });
    assert.equal(lastRequest.url, "/v1/chat/completions");
    assert.equal(lastRequest.auth, "Bearer test-key");
    assert.deepEqual((lastRequest.body as { model: string; messages: unknown }).messages, messages);
    assert.equal((lastRequest.body as { model: string }).model, "test-model");
  });

  test("5xx → failed with the status and body", async () => {
    respond = (_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":{"message":"injected failure"}}');
    };
    const result = await client().complete(messages);
    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.error : "", /^HTTP 500: .*injected failure/);
  });

  test("slower than the timeout → timeout", async () => {
    respond = (_req, res) => setTimeout(() => completion("late")(_req, res, ""), 400);
    assert.deepEqual(await client().complete(messages), { kind: "timeout" });
  });

  test("200 with a body that isn't a chat completion → malformed", async () => {
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"result":"hello"}');
    };
    assert.equal((await client().complete(messages)).kind, "malformed");
    respond = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>oops</html>");
    };
    assert.equal((await client().complete(messages)).kind, "malformed");
  });

  test("passes finish_reason through, so a cut-off answer can be rejected", async () => {
    respond = completion("Price dropped from", "length");
    assert.deepEqual(await client().complete(messages), { kind: "answer", content: "Price dropped from", finishReason: "length" });
  });

  test("unreachable server → failed with a network error", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    const result = await createLlmClient({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "k", model: "m", timeoutMs: 500 }).complete(messages);
    assert.equal(result.kind, "failed");
    assert.match(result.kind === "failed" ? result.error : "", /network error: ECONNREFUSED/);
  });

  test("a caller abort (shutdown) throws", async () => {
    respond = () => {};
    const controller = new AbortController();
    const pending = client().complete(messages, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending);
  });
});
