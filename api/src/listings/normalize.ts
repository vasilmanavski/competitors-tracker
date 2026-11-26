export const LISTING_FIELDS = ["title", "tagline", "price", "description"] as const;
export type ListingField = (typeof LISTING_FIELDS)[number];

/** Billing period; `seat_month` means per seat per month. */
export type PricePeriod = "month" | "year" | "seat_month" | "seat_year";

/** A parsed price. Any free price is `{ amount: 0, currency: null, period: null }`, so all free wordings compare equal. */
export type Price = { amount: number; currency: string | null; period: PricePeriod | null };

/** The four listing fields, cleaned so the same content always normalises to the same values. */
export type NormalizedListing = {
  title: string | null;
  tagline: string | null;
  description: string | null;
  /** The source's wording, cleaned; kept for display and as a fallback when the price can't be parsed. */
  priceText: string | null;
  price: Price | null;
  /** Fields that were missing, null or empty in the response. */
  missing: ListingField[];
};

const NAMED_ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'" };
const ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;
const MAX_CODE_POINT = 0x10ffff;

const SYMBOL_CURRENCIES: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

const MONTH_WORDS = new Set(["mo", "month", "monthly"]);
const YEAR_WORDS = new Set(["yr", "year", "annual", "annually", "annum"]);
const SEAT_WORDS = new Set(["seat", "user"]);

const FREE_PATTERN = /^free(?: forever| plan)?$/i;
const PRICE_PATTERN = /^(?:([$€£])|([A-Z]{3}))?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(.*)$/;
const FREE: Price = { amount: 0, currency: null, period: null };

const PERIOD_SUFFIX: Record<PricePeriod, string> = {
  month: "/mo",
  year: "/yr",
  seat_month: "/seat/mo",
  seat_year: "/seat/yr",
};

function decodeNumericEntity(entity: string, original: string): string {
  const isHex = entity[1] === "x" || entity[1] === "X";
  const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
  return Number.isFinite(code) && code > 0 && code <= MAX_CODE_POINT ? String.fromCodePoint(code) : original;
}

function decodeEntities(value: string): string {
  return value.replace(ENTITY_PATTERN, (original, entity: string) =>
    entity.startsWith("#") ? decodeNumericEntity(entity, original) : (NAMED_ENTITIES[entity.toLowerCase()] ?? original),
  );
}

/** Decodes HTML entities, collapses whitespace and trims. Non-strings and empty results become null. */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = decodeEntities(value).replace(/\s+/g, " ").trim();
  return cleaned === "" ? null : cleaned;
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Parses period words such as "/seat/mo" or "per seat per month".
 * @returns the period, null for a one-off price (no words), or undefined when the wording is unknown
 */
function parsePeriod(rest: string): PricePeriod | null | undefined {
  const words = rest
    .toLowerCase()
    .replace(/\bper\b|\ba\b/g, "/")
    .split(/[\s/]+/)
    .filter((word) => word !== "");
  if (words.length === 0) return null;

  let perSeat = false;
  let unit: "month" | "year" | null = null;
  for (const word of words) {
    if (SEAT_WORDS.has(word) && !perSeat) perSeat = true;
    else if (MONTH_WORDS.has(word) && unit === null) unit = "month";
    else if (YEAR_WORDS.has(word) && unit === null) unit = "year";
    else return undefined;
  }
  if (unit === null) return undefined;
  return perSeat ? `seat_${unit}` : unit;
}

/** Parses an already-normalised price string; null when the format is not recognised. */
export function parsePrice(text: string): Price | null {
  if (FREE_PATTERN.test(text)) return FREE;

  const match = PRICE_PATTERN.exec(text);
  if (!match) return null;
  const [, symbol, code, whole = "", fraction, rest = ""] = match;

  const period = parsePeriod(rest);
  if (period === undefined) return null;

  const amount = roundToCents(Number(`${whole.replace(/,/g, "")}.${fraction ?? "0"}`));
  if (amount === 0) return FREE;
  const currency = symbol ? (SYMBOL_CURRENCIES[symbol] ?? null) : (code ?? null);
  return { amount, currency, period };
}

/** One canonical display form, so "$39/mo" and "USD 39 per month" render the same. */
export function formatPrice(price: Price): string {
  if (price.amount === 0) return "Free";
  const amount = Number.isInteger(price.amount) ? String(price.amount) : price.amount.toFixed(2);
  const prefix = price.currency ? (CURRENCY_SYMBOLS[price.currency] ?? `${price.currency} `) : "";
  const suffix = price.period ? PERIOD_SUFFIX[price.period] : "";
  return `${prefix}${amount}${suffix}`;
}

/** The value a price is compared on: the parsed price when understood, otherwise the cleaned text. */
export function priceKey(price: Price | null, priceText: string | null): string | null {
  if (price) return `${price.amount}|${price.currency ?? ""}|${price.period ?? ""}`;
  return priceText === null ? null : `text|${priceText}`;
}

function isPricePeriod(value: unknown): value is PricePeriod {
  return typeof value === "string" && value in PERIOD_SUFFIX;
}

function isStructuredPrice(value: unknown): value is { amount: number; currency?: unknown; period?: unknown } {
  return typeof value === "object" && value !== null && "amount" in value && typeof value.amount === "number";
}

function normalizeStructuredPrice(value: { amount: number; currency?: unknown; period?: unknown }): Price {
  if (value.amount === 0) return FREE;
  return {
    amount: roundToCents(value.amount),
    currency: typeof value.currency === "string" ? value.currency.toUpperCase() : null,
    period: isPricePeriod(value.period) ? value.period : null,
  };
}

function normalizePrice(value: unknown): { priceText: string | null; price: Price | null } {
  if (isStructuredPrice(value)) {
    const price = normalizeStructuredPrice(value);
    return { priceText: formatPrice(price), price };
  }
  const priceText = normalizeText(value);
  return { priceText, price: priceText === null ? null : parsePrice(priceText) };
}

/**
 * Reduces the source's noisy response to the four listing fields; everything else is dropped.
 * @returns null when the body is not a JSON object
 */
export function normalizeListing(body: unknown): NormalizedListing | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;

  const title = normalizeText(raw.title);
  const tagline = normalizeText(raw.tagline);
  const description = normalizeText(raw.description);
  const { priceText, price } = normalizePrice(raw.price);

  const values: Record<ListingField, string | null> = { title, tagline, price: priceText, description };
  const missing = LISTING_FIELDS.filter((field) => values[field] === null);
  return { title, tagline, description, priceText, price, missing };
}
