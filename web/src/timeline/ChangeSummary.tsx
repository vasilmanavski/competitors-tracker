import type { FieldChange, Snapshot } from "../api.ts";
import { PollingIndicator } from "../PollingIndicator.tsx";
import { summaryNotice } from "./snapshot-labels.ts";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  tagline: "Tagline",
  price: "Price",
  description: "Description",
  availability: "Availability",
};

const RULE_SUMMARY_HINT = "Written from the old and new values, without an AI call.";

function ChangeRow({ change }: { change: FieldChange }) {
  return (
    <li>
      <span className="change-field">{FIELD_LABELS[change.field] ?? change.field}</span>
      <span className="change-values">
        <span className="change-before">{change.before ?? "—"}</span>
        <span className="change-arrow" aria-label="changed to">
          {" → "}
        </span>
        <span className="change-after">{change.after ?? "—"}</span>
      </span>
    </li>
  );
}

function AiSummary({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.summary) {
    const isRule = snapshot.summarySource === "rule";
    return (
      <p className={isRule ? "ai-summary ai-summary--rule" : "ai-summary"}>
        <span className="ai-label" title={isRule ? RULE_SUMMARY_HINT : undefined}>
          {isRule ? "Summary" : "AI summary"}
        </span>
        {snapshot.summary}
      </p>
    );
  }
  const notice = summaryNotice(snapshot);
  if (!notice) return null;
  if (notice.kind === "working") {
    return (
      <p className="ai-summary ai-summary--waiting">
        <PollingIndicator label="Writing an AI summary…" />
      </p>
    );
  }
  return (
    <p className="ai-summary ai-summary--missing">
      <span className="ai-label">No AI summary</span>
      {notice.text}
    </p>
  );
}

/** A change: the old → new values we computed, then the AI summary or why it is missing. */
export function ChangeSummary({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="change-summary">
      {snapshot.changes.length > 0 && (
        <ul className="change-list">
          {snapshot.changes.map((change) => (
            <ChangeRow key={change.field} change={change} />
          ))}
        </ul>
      )}
      <AiSummary snapshot={snapshot} />
    </div>
  );
}
