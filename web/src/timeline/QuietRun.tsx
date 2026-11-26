import { useState } from "react";
import type { Snapshot } from "../api.ts";
import { absoluteTime, shortTime, timeRange } from "../format.ts";
import type { QuietRunKind } from "./group-snapshots.ts";

const RUN_LABELS: Record<QuietRunKind, string> = {
  unchanged: "No change",
  still_not_listed: "Not listed at the source",
};

function pluralChecks(count: number): string {
  return count === 1 ? "1 check" : `${count} checks`;
}

/** A run of uneventful polls as one line; expands to the time of every check in it. */
export function QuietRun({ runKind, snapshots }: { runKind: QuietRunKind; snapshots: Snapshot[] }) {
  const [isExpanded, setExpanded] = useState(false);
  const newest = snapshots[0];
  const oldest = snapshots.at(-1);
  if (!newest || !oldest) return null;

  return (
    <li className={`quiet-run quiet-run--${runKind}`}>
      <button className="quiet-run-toggle" onClick={() => setExpanded(!isExpanded)} aria-expanded={isExpanded}>
        <span className="quiet-run-icon" aria-hidden="true">
          {runKind === "unchanged" ? "✓" : "–"}
        </span>
        <span className="quiet-run-label">{RUN_LABELS[runKind]}</span>
        <span className="muted">
          · {pluralChecks(snapshots.length)} · {timeRange(oldest.fetchedAt, newest.fetchedAt)}
        </span>
        <span className="quiet-run-chevron" aria-hidden="true" />
      </button>
      {isExpanded && (
        <ul className="quiet-run-checks">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} title={absoluteTime(snapshot.fetchedAt)}>
              {shortTime(snapshot.fetchedAt)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
