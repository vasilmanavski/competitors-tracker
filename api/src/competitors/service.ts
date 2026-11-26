import { CompetitorAlreadyTrackedError, CompetitorNotTrackedError } from "./errors.ts";
import type { Competitor, CompetitorRepository } from "./repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A tracked competitor plus the status flags the list view shows. */
export type CompetitorOverview = Competitor & {
  changedLast24h: boolean;
  neverFound: boolean;
};

/** Use cases for the tracked-competitor list. */
export function createCompetitorService(deps: { competitors: CompetitorRepository; now?: () => Date }) {
  const { competitors, now = () => new Date() } = deps;

  function toOverview(competitor: Competitor, at: Date): CompetitorOverview {
    return {
      ...competitor,
      changedLast24h: competitor.lastChangedAt !== null && at.getTime() - competitor.lastChangedAt.getTime() < DAY_MS,
      neverFound: competitor.listingState === "never_listed",
    };
  }

  return {
    async list(): Promise<CompetitorOverview[]> {
      const at = now();
      return (await competitors.list()).map((competitor) => toOverview(competitor, at));
    },

    /**
     * Starts tracking an id. The id is not checked against the source: an unknown
     * id is accepted and shows up as "not found" in its timeline after the first poll.
     * @throws CompetitorAlreadyTrackedError
     */
    async add(id: string): Promise<CompetitorOverview> {
      const created = await competitors.create(id);
      if (!created) throw new CompetitorAlreadyTrackedError(id);
      return toOverview(created, now());
    },

    /**
     * Stops tracking an id and deletes its history.
     * @throws CompetitorNotTrackedError
     */
    async remove(id: string): Promise<void> {
      if (!(await competitors.remove(id))) throw new CompetitorNotTrackedError(id);
    },
  };
}

export type CompetitorService = ReturnType<typeof createCompetitorService>;
