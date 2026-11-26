// Integration tests: real Fastify app + real Postgres, via app.inject() (no port).
// Needs a throwaway database: TEST_DATABASE_URL, default competitorpulse_test.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { buildApp } from "../app.ts";
import { createDb, runMigrations } from "../db/client.ts";

const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/competitorpulse_test";
const { pool, db } = createDb(url);
const app = buildApp({ db }, { logger: false });

const post = (body: unknown) => app.inject({ method: "POST", url: "/api/competitors", payload: body as object });
const list = async () => (await app.inject({ method: "GET", url: "/api/competitors" })).json<{ id: string }[]>();
const del = (id: string) => app.inject({ method: "DELETE", url: `/api/competitors/${encodeURIComponent(id)}` });

before(async () => {
  await runMigrations(db);
});
beforeEach(async () => {
  await db.execute(sql`truncate competitors`);
});
after(async () => {
  await app.close();
  await pool.end();
});

describe("competitors API", () => {
  test("add → list → remove", async () => {
    const created = await post({ id: "acme-crm" });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().id, "acme-crm");

    assert.deepEqual((await list()).map((c) => c.id), ["acme-crm"]);

    const removed = await del("acme-crm");
    assert.equal(removed.statusCode, 204);
    assert.equal(removed.body, "");
    assert.deepEqual(await list(), []);
  });

  test("normalises the id (trim + lowercase)", async () => {
    const res = await post({ id: "  ACME-crm " });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().id, "acme-crm");
    assert.equal((await del("ACME-CRM")).statusCode, 204);
  });

  test("duplicate add → 409", async () => {
    await post({ id: "acme-crm" });
    const res = await post({ id: "Acme-CRM" });
    assert.equal(res.statusCode, 409);
    assert.match(res.json().message, /already tracked/);
  });

  test("concurrent duplicate adds: exactly one wins", async () => {
    const codes = (await Promise.all([post({ id: "race" }), post({ id: "race" })])).map((r) => r.statusCode);
    assert.deepEqual(codes.sort(), [201, 409]);
  });

  for (const body of [{ id: "Bad Id!" }, { id: "" }, { id: "a".repeat(65) }, { id: 42 }, {}, null]) {
    test(`invalid body ${JSON.stringify(body)} → 400 with a message`, async () => {
      const res = await post(body);
      assert.equal(res.statusCode, 400);
      assert.equal(typeof res.json().message, "string");
    });
  }

  test("unknown id at the source is still accepted (decision 1.2)", async () => {
    assert.equal((await post({ id: "does-not-exist" })).statusCode, 201);
  });

  test("delete of an id that isn't tracked → 404", async () => {
    assert.equal((await del("nope")).statusCode, 404);
  });

  test("delete with a malformed id → 400", async () => {
    assert.equal((await del("Bad Id!")).statusCode, 400);
  });

  test("list is in the order competitors were added", async () => {
    for (const id of ["zeta", "alpha", "mid"]) await post({ id });
    assert.deepEqual((await list()).map((c) => c.id), ["zeta", "alpha", "mid"]);
  });
});
