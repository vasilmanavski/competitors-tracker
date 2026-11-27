import type { Snapshot } from "../api.ts";
import { absoluteTime, timeRange } from "../format.ts";
import { type QuietRunKind, quietRunSpan } from "./group-snapshots.ts";

const RUN_LABELS: Record<QuietRunKind, string> = {
  unchanged: "No change",
  still_not_listed: "Not listed at the source",
};

function pluralChecks(count: number): string {
  return count === 1 ? "1 check" : `${count} checks`;
}

/**
 * A run of uneventful polls as a quiet divider between events: it shows the stretch was
 * watched (how many checks, from when to when) without competing with the change cards.
 */
export function QuietRun({ runKind, snapshots }: { runKind: QuietRunKind; snapshots: Snapshot[] }) {
  const span = quietRunSpan(snapshots);
  if (!span) return null;

  return (
    <li className="quiet-run" title={`${absoluteTime(span.from)} – ${absoluteTime(span.to)}`}>
      <span className="quiet-run-text">
        {RUN_LABELS[runKind]} · {pluralChecks(span.checks)} · {timeRange(span.from, span.to)}
      </span>
    </li>
  );
}
