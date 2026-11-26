import { useCallback, useState } from "react";
import { ApiError, listSnapshots, type Snapshot } from "../api.ts";
import { errorMessage } from "../format.ts";
import { AWAITING_POLL_REFRESH_MS, IDLE_REFRESH_MS, useAutoRefresh } from "../useAutoRefresh.ts";
import { mergeSnapshots } from "./snapshot-labels.ts";

const PAGE_SIZE = 200;

export type TimelineState =
  | { state: "loading" }
  | { state: "not_tracked" }
  | { state: "error"; message: string }
  | { state: "ready"; snapshots: Snapshot[]; hasOlder: boolean };

/** Loads a competitor's timeline, refreshes the newest page in the background, and pages back on demand. */
export function useTimeline(id: string) {
  const [timeline, setTimeline] = useState<TimelineState>({ state: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const newest = await listSnapshots(id, { limit: PAGE_SIZE, signal });
        setTimeline((prev) =>
          prev.state === "ready"
            ? { ...prev, snapshots: mergeSnapshots(prev.snapshots, newest) }
            : { state: "ready", snapshots: newest, hasOlder: newest.length === PAGE_SIZE },
        );
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof ApiError && err.status === 404) setTimeline({ state: "not_tracked" });
        else setTimeline((prev) => (prev.state === "ready" ? prev : { state: "error", message: errorMessage(err) }));
      }
    },
    [id],
  );

  const isAwaitingFirstPoll = timeline.state === "ready" && timeline.snapshots.length === 0;
  useAutoRefresh(refresh, isAwaitingFirstPoll ? AWAITING_POLL_REFRESH_MS : IDLE_REFRESH_MS);

  async function loadOlder() {
    const oldest = timeline.state === "ready" ? timeline.snapshots.at(-1) : undefined;
    if (!oldest) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const older = await listSnapshots(id, { limit: PAGE_SIZE, before: oldest.fetchedAt });
      setTimeline((prev) =>
        prev.state === "ready"
          ? { state: "ready", snapshots: mergeSnapshots(prev.snapshots, older), hasOlder: older.length === PAGE_SIZE }
          : prev,
      );
    } catch (err) {
      setOlderError(errorMessage(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  return { timeline, refresh, loadOlder, loadingOlder, olderError };
}
