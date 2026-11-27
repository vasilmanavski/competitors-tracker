import { PollingIndicator } from "../PollingIndicator.tsx";
import { relativeTime } from "../format.ts";
import { groupSnapshots, timelineItemKey } from "./group-snapshots.ts";
import { QuietRun } from "./QuietRun.tsx";
import { SnapshotCard } from "./SnapshotCard.tsx";
import { useTimeline } from "./useTimeline.ts";

/** One competitor's poll history, newest first. */
export function Timeline({ id }: { id: string }) {
  const { timeline, refresh, loadOlder, loadingOlder, olderError } = useTimeline(id);

  return (
    <section>
      <a href="#/" className="button">
        ← Back to competitors
      </a>
      <h2 className="timeline-title">{id}</h2>

      {timeline.state === "loading" && <p>Loading history…</p>}
      {timeline.state === "not_tracked" && (
        <p role="alert">
          {id} is not tracked (it may have been removed). <a href="#/">Back to the list</a>
        </p>
      )}
      {timeline.state === "error" && (
        <p role="alert" className="error">
          Could not load the history: {timeline.message} <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      {timeline.state === "ready" && timeline.snapshots.length === 0 && (
        <div className="timeline-waiting">
          <PollingIndicator label="Fetching the first listing from the source…" />
        </div>
      )}
      {timeline.state === "ready" && timeline.snapshots.length > 0 && (
        <>
          <p className="last-checked muted">Last checked {relativeTime(timeline.snapshots[0]?.lastCheckedAt ?? "")}</p>
          <ol className="timeline">
            {groupSnapshots(timeline.snapshots).map((item) =>
              item.kind === "event" ? (
                <SnapshotCard key={timelineItemKey(item)} snapshot={item.snapshot} />
              ) : (
                <QuietRun key={timelineItemKey(item)} runKind={item.runKind} snapshots={item.snapshots} />
              ),
            )}
          </ol>
          {timeline.hasOlder && (
            <button className="load-older" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? "Loading…" : "Load older"}
            </button>
          )}
          {olderError && (
            <span role="alert" className="error">
              {" "}
              {olderError}
            </span>
          )}
        </>
      )}
    </section>
  );
}
