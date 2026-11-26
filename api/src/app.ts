import Fastify from "fastify";
import type { CompetitorService } from "./competitors/service.ts";
import { registerCompetitorRoutes } from "./competitors/routes.ts";
import { registerErrorHandler } from "./errors.ts";
import { registerHealthRoutes } from "./health/routes.ts";
import type { SnapshotService } from "./snapshots/service.ts";
import { registerSnapshotRoutes } from "./snapshots/routes.ts";

export type AppServices = {
  competitors: CompetitorService;
  snapshots: SnapshotService;
  pingDb: () => Promise<void>;
};

/** Builds the HTTP app without starting it, so tests can call `app.inject()`. */
export function buildApp(services: AppServices, options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  registerErrorHandler(app);
  registerHealthRoutes(app, services.pingDb);
  registerCompetitorRoutes(app, services.competitors);
  registerSnapshotRoutes(app, services.snapshots);
  return app;
}
