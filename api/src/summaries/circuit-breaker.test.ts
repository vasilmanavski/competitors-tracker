import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuitBreaker } from "./circuit-breaker.ts";

const COOLDOWN_MS = 60_000;

function breakerWithClock() {
  let time = 0;
  const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: COOLDOWN_MS, now: () => new Date(time) });
  return { breaker, advance: (ms: number) => (time += ms) };
}

test("closed: every wanted call is allowed", () => {
  const { breaker } = breakerWithClock();
  assert.equal(breaker.allowedCalls(4, 2), 4);
});

test("opens after the threshold of failures in a row, and allows nothing", () => {
  const { breaker } = breakerWithClock();
  assert.equal(breaker.recordFailure(), false);
  assert.equal(breaker.recordFailure(), false);
  assert.equal(breaker.recordFailure(), true);
  assert.equal(breaker.state, "open");
  assert.equal(breaker.allowedCalls(4, 0), 0);
});

test("a success resets the count of failures in a row", () => {
  const { breaker } = breakerWithClock();
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.recordSuccess(), false);
  breaker.recordFailure();
  breaker.recordFailure();
  assert.equal(breaker.state, "closed");
});

test("after the cooldown, one trial call at a time, and only when nothing is running", () => {
  const { breaker, advance } = breakerWithClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure();
  advance(COOLDOWN_MS - 1);
  assert.equal(breaker.allowedCalls(4, 0), 0);
  advance(1);
  assert.equal(breaker.allowedCalls(4, 1), 0);
  assert.equal(breaker.allowedCalls(4, 0), 1);
  assert.equal(breaker.state, "half_open");
});

test("a trial success closes it; a trial failure reopens it for a new cooldown", () => {
  const { breaker, advance } = breakerWithClock();
  for (let i = 0; i < 3; i++) breaker.recordFailure();
  advance(COOLDOWN_MS);
  breaker.allowedCalls(1, 0);
  assert.equal(breaker.recordFailure(), true);
  assert.equal(breaker.allowedCalls(4, 0), 0);

  advance(COOLDOWN_MS);
  breaker.allowedCalls(1, 0);
  assert.equal(breaker.recordSuccess(), true);
  assert.equal(breaker.allowedCalls(4, 0), 4);
});
