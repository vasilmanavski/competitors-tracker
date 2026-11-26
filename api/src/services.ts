import { createCompetitorService } from "./competitors/service.ts";
import { createDataAccess } from "./data-access.ts";
import { type Db, pingDb } from "./db/client.ts";
import { createSnapshotService } from "./snapshots/service.ts";

/** Wires the services that need only the database. */
export function createServices(db: Db) {
  const data = createDataAccess(db);
  return {
    data,
    competitorService: createCompetitorService({ competitorRepository: data.repositories.competitorRepository }),
    snapshotService: createSnapshotService(data),
    pingDb: () => pingDb(db),
  };
}

export type Services = ReturnType<typeof createServices>;
