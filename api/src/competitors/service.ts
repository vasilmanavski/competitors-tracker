import { CompetitorAlreadyTrackedError, CompetitorNotTrackedError } from "./errors.ts";
import type { Competitor, CompetitorRepository } from "./repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A tracked competitor plus the status flags the list view shows. */
export type CompetitorOverview = Competitor & {
  changedLast24h: boolean;
  neverFound: boolean;
};

/** Use cases for the tracked-competitor list. */
export function createCompetitorService(deps: { competitorRepository: CompetitorRepository; now?: () => Date }) {
  const { competitorRepository, now = () => new Date() } = deps;

  function toOverview(competitor: Competitor, at: Date): CompetitorOverview {
    return {
      ...competitor,
      changedLast24h: competitor.lastChangedAt !== null && at.getTime() - competitor.lastChangedAt.getTime() < DAY_MS,
      neverFound: competitor.listingState === "never_listed",
    };
  }

  return {
    /** Every tracked competitor with its status flags, oldest first. */
    async listTracked(): Promise<CompetitorOverview[]> {
      const at = now();
      return (await competitorRepository.findAll()).map((competitor) => toOverview(competitor, at));
    },

    /**
     * Starts tracking an id. The id is not checked against the source: an unknown
     * id is accepted and shows up as "not found" in its timeline after the first poll.
     * @throws CompetitorAlreadyTrackedError
     */
    async startTracking(id: string): Promise<CompetitorOverview> {
      const created = await competitorRepository.insert(id);
      if (!created) throw new CompetitorAlreadyTrackedError(id);
      return toOverview(created, now());
    },

    /**
     * Stops tracking an id and deletes its history.
     * @throws CompetitorNotTrackedError
     */
    async stopTracking(id: string): Promise<void> {
      if (!(await competitorRepository.deleteById(id))) throw new CompetitorNotTrackedError(id);
    },
  };
}

export type CompetitorService = ReturnType<typeof createCompetitorService>;
