import type { ReactNode } from "react";
import type { Snapshot, SnapshotStatus } from "../api.ts";
import { absoluteTime, relativeTime } from "../format.ts";
import { ChangeSummary } from "./ChangeSummary.tsx";
import { changeLabel, noSummaryReason } from "./snapshot-labels.ts";

type FieldName = "title" | "tagline" | "price" | "description";

const PROBLEM_STATUS_LABELS: Record<Exclude<SnapshotStatus, "ok">, string> = {
  partial: "incomplete listing",
  not_found: "not listed",
  fetch_failed: "fetch failed",
};

function Field({ name, snapshot, children }: { name: FieldName; snapshot: Snapshot; children?: ReactNode }) {
  const value = snapshot[name];
  if (value === null) return <span className="muted">({name} missing)</span>;
  const className = snapshot.changedFields.includes(name) ? "field--changed" : undefined;
  return <span className={className}>{children ?? value}</span>;
}

function Listing({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="snapshot-listing">
      <p>
        <Field name="title" snapshot={snapshot}>
          <strong>{snapshot.title}</strong>
        </Field>
        {" — "}
        <Field name="tagline" snapshot={snapshot} />
      </p>
      <p>
        <Field name="price" snapshot={snapshot} />
      </p>
      <p>
        <Field name="description" snapshot={snapshot} />
      </p>
    </div>
  );
}

function Header({ snapshot }: { snapshot: Snapshot }) {
  const label = changeLabel(snapshot);
  return (
    <div className="snapshot-time">
      <span title={relativeTime(snapshot.fetchedAt)}>{absoluteTime(snapshot.fetchedAt)}</span>
      {label && <span className="badge badge--changed">{label}</span>}
      {snapshot.status !== "ok" && <span className="badge badge--muted">{PROBLEM_STATUS_LABELS[snapshot.status]}</span>}
    </div>
  );
}

/** One poll in the timeline: when, the listing as fetched, and what changed or why there is nothing to summarise. */
export function SnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  const hasListing = snapshot.status === "ok" || snapshot.status === "partial";
  const reason = noSummaryReason(snapshot);
  return (
    <li className={snapshot.changed ? "snapshot snapshot--changed" : "snapshot"}>
      <Header snapshot={snapshot} />
      {hasListing && <Listing snapshot={snapshot} />}
      {snapshot.changed && <ChangeSummary snapshot={snapshot} />}
      {reason && <p className="snapshot-reason">{reason}</p>}
    </li>
  );
}
