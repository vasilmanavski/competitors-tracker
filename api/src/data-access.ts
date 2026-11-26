import type { Db, DbExecutor } from "./db/client.ts";
import { createCompetitorRepository } from "./competitors/repository.ts";
import { createSnapshotRepository } from "./snapshots/repository.ts";
import { createLlmUsageRepository } from "./summaries/repository.ts";

/** Builds every repository on the given executor (the pool or a transaction). */
function createRepositories(executor: DbExecutor) {
  return {
    competitorRepository: createCompetitorRepository(executor),
    snapshotRepository: createSnapshotRepository(executor),
    llmUsageRepository: createLlmUsageRepository(executor),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

/** Repositories for single statements, plus `transaction()` for multi-step use cases. */
export type DataAccess = {
  repositories: Repositories;
  transaction<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
};

/** The service layer's only way to reach the database. */
export function createDataAccess(db: Db): DataAccess {
  return {
    repositories: createRepositories(db),
    transaction: (work) => db.transaction((tx) => work(createRepositories(tx))),
  };
}
