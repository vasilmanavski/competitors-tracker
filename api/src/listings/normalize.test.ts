import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatPrice, normalizeListing, normalizeText, parsePrice, priceKey } from "./normalize.ts";

describe("normalizeText", () => {
  const cases: [unknown, string | null][] = [
    ["Track leads & deals in one place.", "Track leads & deals in one place."],
    ["  Track leads & deals in one place. ", "Track leads & deals in one place."],
    ["Track  leads &  deals in  one place.", "Track leads & deals in one place."],
    ["Track leads &amp; deals in one place.", "Track leads & deals in one place."],
    ["Track&nbsp;leads & deals in one place.", "Track leads & deals in one place."],
    ["Track leads & deals in one place.\n", "Track leads & deals in one place."],
    ["Track leads &#38; deals &#x26; more", "Track leads & deals & more"],
    ["", null],
    ["   \n ", null],
    [null, null],
    [undefined, null],
    [42, null],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeText(input), expected);
    });
  }
});

describe("parsePrice", () => {
  const usd39 = { amount: 39, currency: "USD", period: "month" };
  const free = { amount: 0, currency: null, period: null };
  const cases: [string, unknown][] = [
    // Every variant the source produces for $39/month.
    ["$39/mo", usd39],
    ["$39.00/mo", usd39],
    ["$39 / month", usd39],
    ["USD 39 per month", usd39],
    // Free in all its wordings.
    ["Free", free],
    ["$0/mo", free],
    ["Free forever", free],
    ["USD 0 per month", free],
    // Other currencies / periods / seats.
    ["€12.50/yr", { amount: 12.5, currency: "EUR", period: "year" }],
    ["£8 / year", { amount: 8, currency: "GBP", period: "year" }],
    ["GBP 8 per year", { amount: 8, currency: "GBP", period: "year" }],
    ["$15/seat/mo", { amount: 15, currency: "USD", period: "seat_month" }],
    ["$15 / seat / month", { amount: 15, currency: "USD", period: "seat_month" }],
    ["USD 15 per seat per month", { amount: 15, currency: "USD", period: "seat_month" }],
    ["$15.00/seat/mo", { amount: 15, currency: "USD", period: "seat_month" }],
    ["CHF 20/mo", { amount: 20, currency: "CHF", period: "month" }],
    ["$1,299/yr", { amount: 1299, currency: "USD", period: "year" }],
    ["$49", { amount: 49, currency: "USD", period: null }],
    // Unknown formats → null (compared as text instead).
    ["Contact sales", null],
    ["$39 per fortnight", null],
    ["from $10/mo", null],
  ];
  for (const [input, expected] of cases) {
    test(`${input} → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(parsePrice(input), expected);
    });
  }
});

describe("formatPrice", () => {
  test("canonical display", () => {
    assert.equal(formatPrice({ amount: 39, currency: "USD", period: "month" }), "$39/mo");
    assert.equal(formatPrice({ amount: 12.5, currency: "EUR", period: "year" }), "€12.50/yr");
    assert.equal(formatPrice({ amount: 15, currency: "USD", period: "seat_month" }), "$15/seat/mo");
    assert.equal(formatPrice({ amount: 20, currency: "CHF", period: "month" }), "CHF 20/mo");
    assert.equal(formatPrice({ amount: 0, currency: null, period: null }), "Free");
  });
});

describe("normalizeListing", () => {
  const clean = {
    title: "Acme CRM",
    tagline: "Simple CRM for small teams",
    price: "$39/mo",
    description: "Track leads & deals in one place.",
  };

  test("noise fields, key order and format variants all normalise to the same listing", () => {
    const noisy = {
      cache: { hit: true, ageSeconds: 12 },
      description: "Track leads &amp; deals in one place.\n",
      viewerCount: 117,
      price: "USD 39 per month",
      requestId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
      id: "acme-crm",
      title: "  Acme CRM ",
      promoBanner: "Spring sale: 20% off annual plans",
      renderedAt: "2026-11-26T10:00:00.000Z",
      tagline: "Simple&nbsp;CRM for  small teams",
    };
    const { priceText: aText, ...a } = normalizeListing(clean)!;
    const { priceText: bText, ...b } = normalizeListing(noisy)!;
    assert.deepEqual(b, a);
    assert.equal(bText, "USD 39 per month"); // the source's wording is kept for display
    assert.deepEqual(a.missing, []);
    assert.equal(priceKey(a.price, aText), priceKey(b.price, bText));
  });

  for (const [label, patch] of [
    ["missing", { title: undefined }],
    ["null", { title: null }],
    ["empty", { title: "" }],
  ] as const) {
    test(`a ${label} field is reported as missing`, () => {
      const result = normalizeListing({ ...clean, ...patch })!;
      assert.deepEqual(result.missing, ["title"]);
      assert.equal(result.title, null);
    });
  }

  test("a missing price is reported as missing", () => {
    assert.deepEqual(normalizeListing({ ...clean, price: null })!.missing, ["price"]);
  });

  test("an unparseable price is kept as text, not reported missing", () => {
    const result = normalizeListing({ ...clean, price: "Contact  sales" })!;
    assert.deepEqual(result.missing, []);
    assert.equal(result.price, null);
    assert.equal(result.priceText, "Contact sales");
  });

  test("a structured price object is accepted", () => {
    const result = normalizeListing({ ...clean, price: { amount: 39, currency: "USD", period: "month" } })!;
    assert.deepEqual(result.price, { amount: 39, currency: "USD", period: "month" });
    assert.equal(result.priceText, "$39/mo");
  });

  for (const body of [null, "oops", 42, [clean]]) {
    test(`non-object body ${JSON.stringify(body)} → null`, () => {
      assert.equal(normalizeListing(body), null);
    });
  }
});
