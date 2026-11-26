import { useCallback, useState } from "react";
import { listCompetitors, removeCompetitor, type Competitor } from "../api.ts";
import { errorMessage } from "../format.ts";
import { AWAITING_REFRESH_MS, IDLE_REFRESH_MS, useAutoRefresh } from "../useAutoRefresh.ts";
import { AddCompetitorForm } from "./AddCompetitorForm.tsx";
import { CompetitorRow } from "./CompetitorRow.tsx";

type ListState =
  | { state: "loading" }
  | { state: "ready"; competitors: Competitor[] }
  | { state: "error"; message: string };

type RowError = { id: string; message: string };

/** The tracked competitors. Re-fetches after every add or remove, so the list always matches the server. */
export function CompetitorList() {
  const [list, setList] = useState<ListState>({ state: "loading" });
  const [rowError, setRowError] = useState<RowError | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setList({ state: "ready", competitors: await listCompetitors(signal) });
    } catch (err) {
      if (!signal?.aborted) setList({ state: "error", message: errorMessage(err) });
    }
  }, []);

  const isAwaitingFirstPoll =
    list.state === "ready" && list.competitors.some((competitor) => competitor.lastPolledAt === null);
  useAutoRefresh(refresh, isAwaitingFirstPoll ? AWAITING_REFRESH_MS : IDLE_REFRESH_MS);

  async function remove(id: string) {
    setRowError(null);
    try {
      await removeCompetitor(id);
    } catch (err) {
      setRowError({ id, message: errorMessage(err) });
    }
    await refresh();
  }

  return (
    <section>
      <AddCompetitorForm onAdded={refresh} />

      {list.state === "loading" && <p>Loading competitors…</p>}
      {list.state === "error" && (
        <p role="alert" className="error">
          Could not load competitors: {list.message} <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      {list.state === "ready" && list.competitors.length === 0 && <p className="muted">No competitors tracked yet. Add one above.</p>}
      {list.state === "ready" && list.competitors.length > 0 && (
        <ul className="competitor-list">
          {list.competitors.map((competitor) => (
            <CompetitorRow
              key={competitor.id}
              competitor={competitor}
              error={rowError?.id === competitor.id ? rowError.message : null}
              onRemove={(id) => void remove(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
