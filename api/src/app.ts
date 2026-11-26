import Fastify from "fastify";
import type { Db } from "./db/client.ts";
import { sql } from "drizzle-orm";
import { competitorRepository } from "./competitors/repository.ts";
import { competitorRoutes } from "./competitors/routes.ts";
import { snapshotRepository } from "./snapshots/repository.ts";
import { snapshotRoutes } from "./snapshots/routes.ts";

// Builds the HTTP app without starting it, so tests can call app.inject().
export function buildApp(deps: { db: Db }, options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });

  // Served on /health for ops (compose healthcheck, curl) and on /api/health
  // so the web app can reach it through the same /api proxy as everything else.
  for (const path of ["/health", "/api/health"]) {
    app.get(path, async (_request, reply) => {
      try {
        await deps.db.execute(sql`select 1`);
        return { status: "ok", db: "ok" };
      } catch (err) {
        app.log.error(err, "health check: database unreachable");
        return reply.code(503).send({ status: "error", db: "unreachable" });
      }
    });
  }

  const competitors = competitorRepository(deps.db);
  competitorRoutes(app, competitors);
  snapshotRoutes(app, snapshotRepository(deps.db), competitors);

  return app;
}
