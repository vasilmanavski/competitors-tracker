/** Longest summary we show; a longer answer is rambling or ignored the instructions. */
export const MAX_SUMMARY_CHARS = 600;

/** A model answer either becomes the summary, or is rejected with a reason the UI can show. */
export type SummaryCheck = { kind: "usable"; summary: string } | { kind: "unusable"; reason: string };

const STRUCTURED_START = /^(\{|\[|```)/;

/**
 * Decides whether a model answer is fit to show: non-empty plain text, not cut off by
 * the token limit, and short. Whitespace is collapsed before checking.
 */
export function checkSummary(content: string | null, finishReason: string | null): SummaryCheck {
  const summary = (content ?? "").replace(/\s+/g, " ").trim();
  if (summary === "") return { kind: "unusable", reason: "empty answer" };
  if (finishReason !== null && finishReason !== "stop") return { kind: "unusable", reason: `answer cut off (${finishReason})` };
  if (summary.length > MAX_SUMMARY_CHARS) return { kind: "unusable", reason: `answer too long (${summary.length} characters)` };
  if (STRUCTURED_START.test(summary)) return { kind: "unusable", reason: "answer was not plain text" };
  return { kind: "usable", summary };
}
