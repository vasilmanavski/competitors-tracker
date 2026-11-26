import type { Snapshot } from "../api.ts";
import { absoluteTime, relativeTime } from "../format.ts";
import { changeLabel, noSummaryReason } from "./snapshot-labels.ts";

type FieldName = "title" | "tagline" | "price" | "description";
const FIELDS: FieldName[] = ["title", "tagline", "price", "description"];

function FieldRow({ name, snapshot }: { name: FieldName; snapshot: Snapshot }) {
  const value = snapshot[name];
  const isChanged = snapshot.changedFields.includes(name);
  const isMissing = snapshot.missingFields.includes(name);
  return (
    <tr>
      <th>{name}</th>
      <td className={isChanged ? "field--changed" : undefined}>
        {value ?? <em className="muted">{isMissing ? "missing in this response" : "—"}</em>}
      </td>
    </tr>
  );
}

function Summary({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.summary) {
    return (
      <p className="snapshot-summary">
        <strong>Summary:</strong> {snapshot.summary}
      </p>
    );
  }
  return (
    <p className="snapshot-summary muted">
      <strong>No summary:</strong> {noSummaryReason(snapshot)}
    </p>
  );
}

/** One poll in the timeline: when, its status, the listing fields and the summary (or why there is none). */
export function SnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  const label = changeLabel(snapshot);
  const hasListing = snapshot.status === "ok" || snapshot.status === "partial";
  return (
    <li className={snapshot.changed ? "snapshot snapshot--changed" : "snapshot"}>
      <div>
        <strong title={snapshot.fetchedAt}>{absoluteTime(snapshot.fetchedAt)}</strong>{" "}
        <span className="muted">({relativeTime(snapshot.fetchedAt)})</span>{" "}
        <span className={`status--${snapshot.status}`}>[{snapshot.status}]</span>{" "}
        {label && <strong className="changed-badge">{label}</strong>}
      </div>
      {hasListing && (
        <table className="snapshot-fields">
          <tbody>
            {FIELDS.map((name) => (
              <FieldRow key={name} name={name} snapshot={snapshot} />
            ))}
          </tbody>
        </table>
      )}
      <Summary snapshot={snapshot} />
    </li>
  );
}
