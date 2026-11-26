import type { CompetitorOverview } from "./service.ts";

/** Maps a competitor to the `GET /api/competitors` row shape. */
export function toCompetitorDto(competitor: CompetitorOverview) {
  return {
    id: competitor.id,
    createdAt: competitor.createdAt.toISOString(),
    lastPolledAt: competitor.lastPolledAt?.toISOString() ?? null,
    lastStatus: competitor.lastStatus,
    lastChangedAt: competitor.lastChangedAt?.toISOString() ?? null,
    changedLast24h: competitor.changedLast24h,
    listingState: competitor.listingState,
    neverFound: competitor.neverFound,
  };
}
