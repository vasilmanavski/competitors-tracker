import type { Snapshot } from "../api.ts";

/** Why a snapshot has no summary, in words the user understands. */
export function noSummaryReason(snapshot: Snapshot): string {
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
    case "pending":
      return "Change detected. The AI summary hasn't been generated yet.";
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
