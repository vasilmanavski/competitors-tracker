import { useState, type FormEvent } from "react";
import { addCompetitor } from "../api.ts";
import { errorMessage } from "../format.ts";

/** Adds a competitor by id and shows the server's error inline. */
export function AddCompetitorForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addCompetitor(id);
      setId("");
      await onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Competitor id{" "}
        <input
          value={id}
          onChange={(event) => setId(event.target.value)}
          placeholder="e.g. acme-crm"
          aria-invalid={error !== null}
          aria-describedby="add-error"
        />
      </label>{" "}
      <button type="submit" disabled={submitting || id.trim() === ""}>
        {submitting ? "Adding…" : "Add"}
      </button>
      {error && (
        <p id="add-error" role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
