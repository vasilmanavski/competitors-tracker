// Thin typed client for the API contract. Every call goes to same-origin /api
// (Vite proxy in dev, nginx in Docker). Non-2xx responses become ApiError with
// the server's { message }, so views can show it inline.

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

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : `API answered ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return res;
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
  await request(`/api/competitors/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listSnapshots(
  id: string,
  opts: { before?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<Snapshot[]> {
  const query = new URLSearchParams();
  if (opts.limit) query.set("limit", String(opts.limit));
  if (opts.before) query.set("before", opts.before);
  const qs = query.toString() ? `?${query}` : "";
  return (await request(`/api/competitors/${encodeURIComponent(id)}/snapshots${qs}`, { signal: opts.signal })).json();
}
