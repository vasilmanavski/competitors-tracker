import type { FastifyInstance } from "fastify";

const HEALTH_PATHS = ["/health", "/api/health"];

/**
 * Health check on `/health` (compose, curl) and `/api/health` (the web app,
 * through its /api proxy). Answers 503 when the database is unreachable.
 */
export function registerHealthRoutes(app: FastifyInstance, pingDb: () => Promise<void>): void {
  for (const path of HEALTH_PATHS) {
    app.get(path, async (request, reply) => {
      try {
        await pingDb();
        return { status: "ok", db: "ok" };
      } catch (err) {
        request.log.error(err, "health check: database unreachable");
        return reply.code(503).send({ status: "error", db: "unreachable" });
      }
    });
  }
}
