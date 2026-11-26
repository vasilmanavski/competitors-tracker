/** A small spinner with a label, shown while a competitor waits for its first poll. */
export function PollingIndicator({ label }: { label: string }) {
  return (
    <span className="polling-indicator" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}
