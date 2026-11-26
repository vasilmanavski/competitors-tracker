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
        <p className="muted">Waiting for the first poll…</p>
      )}
      {timeline.state === "ready" && timeline.snapshots.length > 0 && (
        <>
          <ol className="timeline">
            {timeline.snapshots.map((snapshot) => (
              <SnapshotCard key={snapshot.id} snapshot={snapshot} />
            ))}
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
