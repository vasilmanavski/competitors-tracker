export type SnapshotStatus = "ok" | "partial" | "not_found" | "fetch_failed";
export type ListingState = "unknown" | "listed" | "never_listed" | "delisted";

export type Competitor = {
  id: string;
  createdAt: string;
  lastPolledAt: string | null;
  lastStatus: SnapshotStatus | null;
  lastChangedAt: string | null;
  changedLast24h: boolean;
  listingState: ListingState;
  neverFound: boolean;
};

export type SummaryStatus =
  | "first_snapshot"
  | "not_changed"
  | "fetch_failed"
  | "not_found"
  | "incomplete_listing"
  | "pending";

export type Snapshot = {
  id: number;
  fetchedAt: string;
  status: SnapshotStatus;
  title: string | null;
  tagline: string | null;
  price: string | null;
  priceRaw: string | null;
  description: string | null;
  changed: boolean;
  changedFields: string[];
  missingFields: string[];
  summary: string | null;
  summaryStatus: SummaryStatus;
  error: string | null;
};

/** A non-2xx API response, carrying the server's `{ message }`. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function messageOf(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  const hasMessage = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string";
  return hasMessage ? (body.message as string) : `API answered ${res.status}`;
}

/** Same-origin call to the API. @throws ApiError on a non-2xx response */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (!res.ok) throw new ApiError(res.status, await messageOf(res));
  return res;
}

function competitorPath(id: string): string {
  return `/api/competitors/${encodeURIComponent(id)}`;
}

export async function listCompetitors(signal?: AbortSignal): Promise<Competitor[]> {
  return (await request("/api/competitors", { signal })).json();
}

export async function addCompetitor(id: string): Promise<Competitor> {
  const res = await request("/api/competitors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export async function removeCompetitor(id: string): Promise<void> {
  await request(competitorPath(id), { method: "DELETE" });
}

/** One page of a competitor's timeline, newest first; `before` loads older snapshots. */
export async function listSnapshots(
  id: string,
  opts: { before?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<Snapshot[]> {
  const query = new URLSearchParams();
  if (opts.limit) query.set("limit", String(opts.limit));
  if (opts.before) query.set("before", opts.before);
  const queryString = query.size > 0 ? `?${query}` : "";
  return (await request(`${competitorPath(id)}/snapshots${queryString}`, { signal: opts.signal })).json();
}
