import type { Competitor, SnapshotStatus } from "../api.ts";
import { absoluteTime, relativeTime } from "../format.ts";
import { timelineHref } from "../router.ts";

const STATUS_LABELS: Record<SnapshotStatus, string> = {
  ok: "ok",
  partial: "incomplete listing",
  not_found: "not listed at source",
  fetch_failed: "fetch failed",
};

const NEVER_FOUND_HINT = "Every answer from the source so far was 404. Check the id for a typo.";

function LastPoll({ competitor }: { competitor: Competitor }) {
  const { lastPolledAt, lastStatus } = competitor;
  if (!lastPolledAt || !lastStatus) return <span className="muted">not polled yet</span>;
  return (
    <span className="muted" title={absoluteTime(lastPolledAt)}>
      last poll {relativeTime(lastPolledAt)}: {STATUS_LABELS[lastStatus]}
    </span>
  );
}

type CompetitorRowProps = {
  competitor: Competitor;
  error: string | null;
  onRemove: (id: string) => void;
};

/** One competitor: link to its timeline, status badges, last poll and a remove button. */
export function CompetitorRow({ competitor, error, onRemove }: CompetitorRowProps) {
  const { id, changedLast24h, lastChangedAt, neverFound } = competitor;
  return (
    <li className="competitor-row">
      <a href={timelineHref(id)}>
        <code>{id}</code>
      </a>{" "}
      {changedLast24h && (
        <strong className="changed-badge" title={lastChangedAt ? absoluteTime(lastChangedAt) : undefined}>
          ● changed in last 24 h
        </strong>
      )}{" "}
      {neverFound && (
        <strong className="warning-badge" title={NEVER_FOUND_HINT}>
          ⚠ never found at source
        </strong>
      )}{" "}
      <LastPoll competitor={competitor} />{" "}
      <button onClick={() => onRemove(id)} aria-label={`Remove ${id}`}>
        Remove
      </button>
      {error && (
        <span role="alert" className="error">
          {" "}
          {error}
        </span>
      )}
    </li>
  );
}
