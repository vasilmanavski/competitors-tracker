import { shortTime } from "../format.ts";
import type { Snapshot } from "../api.ts";

/** Why a poll has nothing to summarise, or null when it is a change (see `summaryNotice`). */
export function noSummaryReason(snapshot: Snapshot): string | null {
  switch (snapshot.summaryStatus) {
    case "first_snapshot":
      return "First snapshot, nothing to compare with yet.";
    case "not_changed":
      return "No change since previous snapshot.";
    case "fetch_failed":
      return `Fetch failed: ${snapshot.error ?? "unknown error"}. The last good listing stays the baseline.`;
    case "not_found":
      return "Not listed at the source (404).";
    case "incomplete_listing":
      return `Incomplete listing from the source (missing: ${snapshot.missingFields.join(", ") || "?"}), ignored for comparison.`;
    default:
      return null;
  }
}

/** What to say about a change's AI summary when there isn't one (yet). */
export type SummaryNotice = { kind: "working" } | { kind: "missing"; text: string };

function retryText(retryAt: string | null, gaveUp: string): string {
  return retryAt ? `Trying again at ${shortTime(retryAt)}.` : gaveUp;
}

/** Explains a change's missing AI summary; null when the summary is there. */
export function summaryNotice(snapshot: Snapshot): SummaryNotice | null {
  const { summaryStatus, summaryError, summaryRetryAt, summaryAttempts } = snapshot;
  const gaveUp = `Gave up after ${summaryAttempts === 1 ? "1 attempt" : `${summaryAttempts} attempts`}.`;
  switch (summaryStatus) {
    case "pending":
      return { kind: "working" };
    case "llm_timeout":
      return { kind: "missing", text: `The AI didn't answer in time. ${retryText(summaryRetryAt, gaveUp)}` };
    case "llm_failed":
      return { kind: "missing", text: `The AI service failed (${summaryError ?? "unknown error"}). ${retryText(summaryRetryAt, gaveUp)}` };
    case "unusable_output":
      return { kind: "missing", text: `The AI's answer couldn't be used (${summaryError ?? "unknown reason"}), so it isn't shown.` };
    case "daily_cap_reached":
      return {
        kind: "missing",
        text: `Today's limit of AI summaries is used up. ${summaryRetryAt ? `It will be written after the limit resets at midnight UTC (${shortTime(summaryRetryAt)} your time).` : ""}`.trim(),
      };
    default:
      return null;
  }
}

/** A short headline for a change ("Changed: price"), or null when nothing changed. */
export function changeLabel(snapshot: Snapshot): string | null {
  if (!snapshot.changed) return null;
  if (!snapshot.changedFields.includes("availability")) return `Changed: ${snapshot.changedFields.join(", ")}`;
  if (snapshot.status === "not_found") return "Removed from the source";
  const otherFields = snapshot.changedFields.filter((field) => field !== "availability");
  return otherFields.length > 0 ? `Back at the source, changed: ${otherFields.join(", ")}` : "Back at the source";
}

/** Merges two pages by id, newest first, so a refresh never drops already-loaded older pages. */
export function mergeSnapshots(current: Snapshot[], incoming: Snapshot[]): Snapshot[] {
  const byId = new Map(current.map((snapshot) => [snapshot.id, snapshot]));
  for (const snapshot of incoming) byId.set(snapshot.id, snapshot);
  return [...byId.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt) || b.id - a.id);
}
