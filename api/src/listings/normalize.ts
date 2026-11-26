// Decision 2.4: reduce the source's messy response to 4 clean fields, so the
// same content always normalises to the same values. Pure functions, no I/O.
//
// Everything else in the response (requestId, renderedAt, viewerCount,
// promoBanner, cache, key order, ...) is dropped here and never stored.

export const LISTING_FIELDS = ["title", "tagline", "price", "description"] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

// "seat_month" = per seat per month. Unknown wording → price stays unparsed.
export type PricePeriod = "month" | "year" | "seat_month" | "seat_year";

// A free price is { amount: 0, currency: null, period: null } whatever its
// wording ("Free", "$0/mo", "Free forever"), so all of them compare equal.
export type Price = { amount: number; currency: string | null; period: PricePeriod | null };

export type NormalizedListing = {
  title: string | null;
  tagline: string | null;
  description: string | null;
  priceText: string | null; // cleaned wording, kept for display and as fallback
  price: Price | null; // null when absent or in a format we don't recognise
  missing: ListingField[]; // fields that were missing, null or empty
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// Decode HTML entities, turn every whitespace run (incl. nbsp, \n) into one
// space, trim. Non-strings and empty results become null ("missing").
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = decodeEntities(value).replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

const SYMBOL_CURRENCIES: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

const MONTH_WORDS = new Set(["mo", "month", "monthly"]);
const YEAR_WORDS = new Set(["yr", "year", "annual", "annually", "annum"]);
const SEAT_WORDS = new Set(["seat", "user"]);

// "/seat/mo", " / seat / month", "per seat per month" → "seat_month".
// "" → null (a one-off price). Anything we don't recognise → undefined.
function parsePeriod(rest: string): PricePeriod | null | undefined {
  const words = rest
    .toLowerCase()
    .replace(/\bper\b|\ba\b/g, "/")
    .split(/[\s/]+/)
    .filter((w) => w !== "");
  if (words.length === 0) return null;
  let seat = false;
  let unit: "month" | "year" | null = null;
  for (const word of words) {
    if (SEAT_WORDS.has(word) && !seat) seat = true;
    else if (MONTH_WORDS.has(word) && unit === null) unit = "month";
    else if (YEAR_WORDS.has(word) && unit === null) unit = "year";
    else return undefined;
  }
  if (unit === null) return undefined;
  return seat ? (`seat_${unit}` as const) : unit;
}

const FREE_PATTERN = /^free(?: forever| plan)?$/i;
// Optional currency (symbol or ISO code), amount, then period words.
const PRICE_PATTERN = /^(?:([$€£])|([A-Z]{3}))?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(.*)$/;

// Parse an already-normalised price string. Returns null when the format is
// unknown; callers then fall back to comparing the cleaned text.
export function parsePrice(text: string): Price | null {
  if (FREE_PATTERN.test(text)) return { amount: 0, currency: null, period: null };
  const match = PRICE_PATTERN.exec(text);
  if (!match) return null;
  const [, symbol, code, whole = "", fraction, rest = ""] = match;
  const period = parsePeriod(rest);
  if (period === undefined) return null;
  const amount = Math.round(Number(`${whole.replace(/,/g, "")}.${fraction ?? "0"}`) * 100) / 100;
  if (amount === 0) return { amount: 0, currency: null, period: null };
  const currency = symbol ? (SYMBOL_CURRENCIES[symbol] ?? null) : (code ?? null);
  return { amount, currency, period };
}

const PERIOD_SUFFIX: Record<PricePeriod, string> = {
  month: "/mo",
  year: "/yr",
  seat_month: "/seat/mo",
  seat_year: "/seat/yr",
};

// One canonical display form, so the timeline doesn't flip between "$39/mo"
// and "USD 39 per month" for the same price.
export function formatPrice(price: Price): string {
  if (price.amount === 0) return "Free";
  const amount = Number.isInteger(price.amount) ? String(price.amount) : price.amount.toFixed(2);
  const prefix = price.currency
    ? (CURRENCY_SYMBOLS[price.currency] ?? `${price.currency} `)
    : "";
  return `${prefix}${amount}${price.period ? PERIOD_SUFFIX[price.period] : ""}`;
}

// The key a price is compared on: the parsed value when we understood it,
// otherwise the cleaned text (so an unknown format still detects edits).
export function priceKey(price: Price | null, priceText: string | null): string | null {
  if (price) return `${price.amount}|${price.currency ?? ""}|${price.period ?? ""}`;
  return priceText === null ? null : `text|${priceText}`;
}

function isPeriod(value: unknown): value is PricePeriod {
  return typeof value === "string" && value in PERIOD_SUFFIX;
}

// Accept a structured price too ({ amount, currency, period }), in case a
// source sends one; the provided one always sends a display string.
function normalizePrice(value: unknown): { priceText: string | null; price: Price | null } {
  if (value && typeof value === "object" && "amount" in value && typeof value.amount === "number") {
    const v = value as { amount: number; currency?: unknown; period?: unknown };
    const price: Price =
      v.amount === 0
        ? { amount: 0, currency: null, period: null }
        : {
            amount: Math.round(v.amount * 100) / 100,
            currency: typeof v.currency === "string" ? v.currency.toUpperCase() : null,
            period: isPeriod(v.period) ? v.period : null,
          };
    return { priceText: formatPrice(price), price };
  }
  const priceText = normalizeText(value);
  return { priceText, price: priceText === null ? null : parsePrice(priceText) };
}

// Returns null when the body isn't a JSON object at all (treated as a failed fetch).
export function normalizeListing(body: unknown): NormalizedListing | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const title = normalizeText(raw.title);
  const tagline = normalizeText(raw.tagline);
  const description = normalizeText(raw.description);
  const { priceText, price } = normalizePrice(raw.price);
  const present: Record<ListingField, boolean> = {
    title: title !== null,
    tagline: tagline !== null,
    price: priceText !== null,
    description: description !== null,
  };
  const missing = LISTING_FIELDS.filter((field) => !present[field]);
  return { title, tagline, description, priceText, price, missing };
}
