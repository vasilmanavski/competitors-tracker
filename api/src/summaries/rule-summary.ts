import type { FieldChange } from "../listings/field-changes.ts";
import { parsePrice } from "../listings/normalize.ts";

const TEXT_FIELDS: ReadonlySet<FieldChange["field"]> = new Set(["tagline", "description"]);

function percentChange(before: number, after: number): string {
  const percent = Math.round(((after - before) / before) * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function describePrice(before: string | null, after: string | null): string {
  if (before === null || after === null) return `Price changed to ${after ?? "nothing"}.`;
  const [was, now] = [parsePrice(before), parsePrice(after)];
  if (!was || !now) return `Price changed from ${before} to ${after}.`;
  if (now.amount === 0) return `Now free (was ${before}).`;
  if (was.amount === 0) return `No longer free: now ${after}.`;
  if (was.currency !== now.currency || was.period !== now.period) return `Price changed from ${before} to ${after}.`;
  const direction = now.amount < was.amount ? "dropped" : "rose";
  return `Price ${direction} from ${before} to ${after} (${percentChange(was.amount, now.amount)}).`;
}

function describe(change: FieldChange): string {
  switch (change.field) {
    case "price":
      return describePrice(change.before, change.after);
    case "title":
      return `Renamed from "${change.before ?? ""}" to "${change.after ?? ""}".`;
    case "availability":
      return change.after === "listed"
        ? "Back on the source after being unavailable."
        : "Removed from the source: the listing is no longer available.";
    case "tagline":
    case "description":
      return "";
  }
}

/**
 * Writes the summary ourselves when every change is structured (price, title, availability):
 * the old and new values say it all, so an LLM call would only cost budget and risk a wrong
 * number. Returns null when wording changed (tagline, description) and the LLM should explain it.
 */
export function ruleSummary(changes: FieldChange[]): string | null {
  if (changes.length === 0 || changes.some((change) => TEXT_FIELDS.has(change.field))) return null;
  return changes.map(describe).join(" ");
}
