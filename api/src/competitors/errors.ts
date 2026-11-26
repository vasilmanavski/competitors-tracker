import { ConflictError, NotFoundError } from "../errors.ts";

/** The competitor id is not in the tracked list. */
export class CompetitorNotTrackedError extends NotFoundError {
  constructor(id: string) {
    super(`${id} is not tracked`);
  }
}

/** The competitor id is already in the tracked list. */
export class CompetitorAlreadyTrackedError extends ConflictError {
  constructor(id: string) {
    super(`${id} is already tracked`);
  }
}
