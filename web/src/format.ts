const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** "just now", "12 s ago", "5 min ago", "3 h ago" or "4 days ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < MINUTE) return `${seconds} s ago`;
  if (seconds < HOUR) return `${Math.round(seconds / MINUTE)} min ago`;
  const hours = Math.round(seconds / HOUR);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
