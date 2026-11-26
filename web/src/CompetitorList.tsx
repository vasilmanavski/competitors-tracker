import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addCompetitor, listCompetitors, removeCompetitor, type Competitor } from "./api.ts";
import { absoluteTime, errorMessage, relativeTime } from "./format.ts";

// Polls land in the background, so the list re-fetches on a timer too.
const REFRESH_MS = 15_000;

const STATUS_LABEL: Record<NonNullable<Competitor["lastStatus"]>, string> = {
  ok: "ok",
  partial: "incomplete listing",
  not_found: "not listed at source",
  fetch_failed: "fetch failed",
};

function PollStatus({ c }: { c: Competitor }) {
  if (!c.lastPolledAt || !c.lastStatus) return <span style={{ color: "gray" }}>not polled yet</span>;
  return (
    <span style={{ color: "gray" }} title={absoluteTime(c.lastPolledAt)}>
      last poll {relativeTime(c.lastPolledAt)}: {STATUS_LABEL[c.lastStatus]}
    </span>
  );
}

type ListState =
  | { state: "loading" }
  | { state: "ready"; competitors: Competitor[] }
  | { state: "error"; message: string };

// The server is the source of truth: after every add/remove we re-fetch the
// list rather than patching local state, so the UI can't drift from the DB.
export function CompetitorList() {
  const [list, setList] = useState<ListState>({ state: "loading" });
  const [newId, setNewId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setList({ state: "ready", competitors: await listCompetitors(signal) });
    } catch (err) {
      if (signal?.aborted) return;
      setList({ state: "error", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [refresh]);

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await addCompetitor(newId);
      setNewId("");
      await refresh();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onRemove(id: string) {
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
      <h2>Competitors</h2>

      <form onSubmit={onAdd}>
        <label>
          Competitor id{" "}
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="e.g. acme-crm"
            aria-invalid={formError !== null}
            aria-describedby="add-error"
          />
        </label>{" "}
        <button type="submit" disabled={submitting || newId.trim() === ""}>
          {submitting ? "Adding…" : "Add"}
        </button>
        {formError && (
          <p id="add-error" role="alert" style={{ color: "crimson" }}>
            {formError}
          </p>
        )}
      </form>

      {list.state === "loading" && <p>Loading competitors…</p>}
      {list.state === "error" && (
        <p role="alert" style={{ color: "crimson" }}>
          Could not load competitors: {list.message}{" "}
          <button onClick={() => void refresh()}>Retry</button>
        </p>
      )}
      {list.state === "ready" && list.competitors.length === 0 && (
        <p>No competitors tracked yet. Add one above.</p>
      )}
      {list.state === "ready" && list.competitors.length > 0 && (
        <ul>
          {list.competitors.map((c) => (
            <li key={c.id} style={{ marginBottom: "0.4rem" }}>
              <a href={`#/competitors/${encodeURIComponent(c.id)}`}>
                <code>{c.id}</code>
              </a>{" "}
              {c.changedLast24h && (
                <strong style={{ color: "darkorange" }} title={c.lastChangedAt ? absoluteTime(c.lastChangedAt) : undefined}>
                  ● changed in last 24 h
                </strong>
              )}{" "}
              {c.neverFound && (
                <strong style={{ color: "crimson" }} title="Every answer from the source so far was 404. Check the id for a typo.">
                  ⚠ never found at source
                </strong>
              )}{" "}
              <PollStatus c={c} />{" "}
              <button onClick={() => void onRemove(c.id)} aria-label={`Remove ${c.id}`}>
                Remove
              </button>
              {rowError?.id === c.id && (
                <span role="alert" style={{ color: "crimson" }}>
                  {" "}
                  {rowError.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
