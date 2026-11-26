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
  if (!lastPolledAt || !lastStatus) return <span className="competitor-meta muted">not polled yet</span>;
  return (
    <span className="competitor-meta muted" title={absoluteTime(lastPolledAt)}>
      last poll {relativeTime(lastPolledAt)} · {STATUS_LABELS[lastStatus]}
    </span>
  );
}

function Badges({ competitor }: { competitor: Competitor }) {
  const { changedLast24h, lastChangedAt, neverFound } = competitor;
  return (
    <>
      {changedLast24h && (
        <span className="badge badge--changed" title={lastChangedAt ? absoluteTime(lastChangedAt) : undefined}>
          changed in last 24 h
        </span>
      )}
      {neverFound && (
        <span className="badge badge--warning" title={NEVER_FOUND_HINT}>
          never found at source
        </span>
      )}
    </>
  );
}

type CompetitorRowProps = {
  competitor: Competitor;
  error: string | null;
  onRemove: (id: string) => void;
};

/** One competitor: link to its timeline, status badges, last poll and a remove button. */
export function CompetitorRow({ competitor, error, onRemove }: CompetitorRowProps) {
  const { id } = competitor;
  return (
    <li className="competitor-row">
      <div className="competitor-main">
        <a href={timelineHref(id)}>{id}</a>
        <Badges competitor={competitor} />
        <LastPoll competitor={competitor} />
        {error && (
          <span role="alert" className="competitor-meta error">
            {error}
          </span>
        )}
      </div>
      <button onClick={() => onRemove(id)} aria-label={`Remove ${id}`}>
        Remove
      </button>
    </li>
  );
}
