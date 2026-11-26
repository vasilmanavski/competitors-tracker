import { SnapshotCard } from "./SnapshotCard.tsx";
import { useTimeline } from "./useTimeline.ts";

/** One competitor's poll history, newest first. */
export function Timeline({ id }: { id: string }) {
  const { timeline, refresh, loadOlder, loadingOlder, olderError } = useTimeline(id);

  return (
    <section>
      <p>
        <a href="#/">← All competitors</a>
      </p>
      <h2>
        Timeline: <code>{id}</code>
      </h2>

      {timeline.state === "loading" && <p>Loading history…</p>}
      {timeline.state === "not_tracked" && (
        <p role="alert">
          <code>{id}</code> is not tracked (it may have been removed). <a href="#/">Back to the list</a>
        </p>
      )}
      {timeline.state === "error" && (
        <p role="alert" className="error">
          Could not load the history: {timeline.message} <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      {timeline.state === "ready" && timeline.snapshots.length === 0 && (
        <p>No polls yet. The first one runs within a few seconds of adding a competitor. This page refreshes itself.</p>
      )}
      {timeline.state === "ready" && timeline.snapshots.length > 0 && (
        <>
          <ol className="timeline">
            {timeline.snapshots.map((snapshot) => (
              <SnapshotCard key={snapshot.id} snapshot={snapshot} />
            ))}
          </ol>
          {timeline.hasOlder && (
            <button onClick={() => void loadOlder()} disabled={loadingOlder}>
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
