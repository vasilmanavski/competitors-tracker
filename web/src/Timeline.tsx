import { useCallback, useEffect, useState } from "react";
import { ApiError, listSnapshots, type Snapshot } from "./api.ts";
import { absoluteTime, errorMessage, relativeTime } from "./format.ts";

const PAGE_SIZE = 50;
const REFRESH_MS = 15_000;

type TimelineState =
  | { state: "loading" }
  | { state: "not_tracked" }
  | { state: "error"; message: string }
  | { state: "ready"; snapshots: Snapshot[]; hasOlder: boolean };

// Newest first; merge by id so a background refresh doesn't drop older pages.
function merge(current: Snapshot[], incoming: Snapshot[]): Snapshot[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt) || b.id - a.id);
}

// The brief: the UI must say *why* there's no summary.
function noSummaryReason(s: Snapshot): string {
  switch (s.summaryStatus) {
    case "first_snapshot":
      return "First snapshot, nothing to compare with yet.";
    case "not_changed":
      return "No change since the previous listing.";
    case "fetch_failed":
      return `Fetch failed: ${s.error ?? "unknown error"}. The last good listing stays the baseline.`;
    case "not_found":
      return "Not listed at the source (404).";
    case "incomplete_listing":
      return `Incomplete listing from the source (missing: ${s.missingFields.join(", ") || "?"}), ignored for comparison.`;
    case "pending":
      return "Change detected. The AI summary hasn't been generated yet.";
  }
}

function changeLabel(s: Snapshot): string | null {
  if (!s.changed) return null;
  if (s.changedFields.includes("availability")) {
    if (s.status === "not_found") return "Removed from the source";
    const others = s.changedFields.filter((f) => f !== "availability");
    return others.length > 0 ? `Back at the source, changed: ${others.join(", ")}` : "Back at the source";
  }
  return `Changed: ${s.changedFields.join(", ")}`;
}

const STATUS_COLORS: Record<Snapshot["status"], string> = {
  ok: "seagreen",
  partial: "darkgoldenrod",
  not_found: "gray",
  fetch_failed: "crimson",
};

function Field({ name, value, s }: { name: string; value: string | null; s: Snapshot }) {
  const changed = s.changedFields.includes(name);
  const missing = s.missingFields.includes(name);
  return (
    <tr>
      <th style={{ textAlign: "left", verticalAlign: "top", paddingRight: "1rem", fontWeight: "normal", color: "gray" }}>
        {name}
      </th>
      <td style={changed ? { background: "#fff3cd", fontWeight: 600 } : undefined}>
        {value ?? <em style={{ color: "gray" }}>{missing ? "missing in this response" : "—"}</em>}
      </td>
    </tr>
  );
}

function SnapshotCard({ s }: { s: Snapshot }) {
  const label = changeLabel(s);
  const hasListing = s.status === "ok" || s.status === "partial";
  return (
    <li
      style={{
        listStyle: "none",
        borderLeft: `4px solid ${s.changed ? "darkorange" : "#ddd"}`,
        padding: "0.5rem 0.75rem",
        marginBottom: "0.75rem",
      }}
    >
      <div>
        <strong title={s.fetchedAt}>{absoluteTime(s.fetchedAt)}</strong>{" "}
        <span style={{ color: "gray" }}>({relativeTime(s.fetchedAt)})</span>{" "}
        <span style={{ color: STATUS_COLORS[s.status] }}>[{s.status}]</span>{" "}
        {label && <strong style={{ color: "darkorange" }}>{label}</strong>}
      </div>
      {hasListing && (
        <table style={{ margin: "0.4rem 0" }}>
          <tbody>
            <Field name="title" value={s.title} s={s} />
            <Field name="tagline" value={s.tagline} s={s} />
            <Field name="price" value={s.price} s={s} />
            <Field name="description" value={s.description} s={s} />
          </tbody>
        </table>
      )}
      <p style={{ margin: "0.25rem 0" }}>
        {s.summary ? (
          <>
            <strong>Summary:</strong> {s.summary}
          </>
        ) : (
          <span style={{ color: "gray" }}>
            <strong>No summary:</strong> {noSummaryReason(s)}
          </span>
        )}
      </p>
    </li>
  );
}

export function Timeline({ id }: { id: string }) {
  const [view, setView] = useState<TimelineState>({ state: "loading" });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const newest = await listSnapshots(id, { limit: PAGE_SIZE, signal });
        setView((prev) =>
          prev.state === "ready"
            ? { ...prev, snapshots: merge(prev.snapshots, newest) }
            : { state: "ready", snapshots: newest, hasOlder: newest.length === PAGE_SIZE },
        );
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof ApiError && err.status === 404) setView({ state: "not_tracked" });
        else setView((prev) => (prev.state === "ready" ? prev : { state: "error", message: errorMessage(err) }));
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [refresh]);

  async function loadOlder() {
    if (view.state !== "ready") return;
    const oldest = view.snapshots.at(-1);
    if (!oldest) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const older = await listSnapshots(id, { limit: PAGE_SIZE, before: oldest.fetchedAt });
      setView((prev) =>
        prev.state === "ready"
          ? { state: "ready", snapshots: merge(prev.snapshots, older), hasOlder: older.length === PAGE_SIZE }
          : prev,
      );
    } catch (err) {
      setOlderError(errorMessage(err));
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section>
      <p>
        <a href="#/">← All competitors</a>
      </p>
      <h2>
        Timeline: <code>{id}</code>
      </h2>

      {view.state === "loading" && <p>Loading history…</p>}
      {view.state === "not_tracked" && (
        <p role="alert">
          <code>{id}</code> is not tracked (it may have been removed). <a href="#/">Back to the list</a>
        </p>
      )}
      {view.state === "error" && (
        <p role="alert" style={{ color: "crimson" }}>
          Could not load the history: {view.message} <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      {view.state === "ready" && view.snapshots.length === 0 && (
        <p>No polls yet. The first one runs within a few seconds of adding a competitor. This page refreshes itself.</p>
      )}
      {view.state === "ready" && view.snapshots.length > 0 && (
        <>
          <ol style={{ padding: 0 }}>
            {view.snapshots.map((s) => (
              <SnapshotCard key={s.id} s={s} />
            ))}
          </ol>
          {view.hasOlder && (
            <button onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? "Loading…" : "Load older"}
            </button>
          )}
          {olderError && <span role="alert" style={{ color: "crimson" }}> {olderError}</span>}
        </>
      )}
    </section>
  );
}
