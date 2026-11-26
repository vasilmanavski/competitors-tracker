import type { Snapshot } from "../api.ts";

/** Why a run of snapshots is uneventful: same listing as before, or still absent from the source. */
export type QuietRunKind = "unchanged" | "still_not_listed";

/** A timeline row: one snapshot worth a full card, or a run of uneventful polls shown as one line. */
export type TimelineItem =
  | { kind: "event"; snapshot: Snapshot }
  | { kind: "quiet_run"; runKind: QuietRunKind; snapshots: Snapshot[] };

function quietRunKind(snapshot: Snapshot): QuietRunKind | null {
  switch (snapshot.summaryStatus) {
    case "not_changed":
      return "unchanged";
    case "not_found":
      return "still_not_listed";
    default:
      return null;
  }
}

/**
 * Groups a newest-first timeline: consecutive uneventful polls of the same kind collapse
 * into one run, while firsts, changes, failures and incomplete listings stay individual events.
 */
export function groupSnapshots(snapshots: Snapshot[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const snapshot of snapshots) {
    const runKind = quietRunKind(snapshot);
    const previous = items.at(-1);
    if (runKind === null) {
      items.push({ kind: "event", snapshot });
    } else if (previous?.kind === "quiet_run" && previous.runKind === runKind) {
      previous.snapshots.push(snapshot);
    } else {
      items.push({ kind: "quiet_run", runKind, snapshots: [snapshot] });
    }
  }
  return items;
}

/** A key that survives new polls joining the run at its newest end. */
export function timelineItemKey(item: TimelineItem): string {
  if (item.kind === "event") return `event-${item.snapshot.id}`;
  return `run-${item.snapshots.at(-1)?.id}`;
}
