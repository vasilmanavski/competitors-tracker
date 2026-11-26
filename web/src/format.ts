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

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Time of day, with the date only when it isn't today. */
export function shortTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return isSameDay(date, now) ? time : `${date.toLocaleDateString()} ${time}`;
}

/** "10:52:42 – 10:53:43", or a single time for a one-poll range. */
export function timeRange(fromIso: string, toIso: string): string {
  return fromIso === toIso ? shortTime(fromIso) : `${shortTime(fromIso)} – ${shortTime(toIso)}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
