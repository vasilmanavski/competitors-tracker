import type { FastifyInstance } from "fastify";
import { CompetitorId, CreateCompetitorBody } from "./competitor-id.ts";
import { toCompetitorDto } from "./dto.ts";
import type { CompetitorService } from "./service.ts";

/** `GET/POST /api/competitors` and `DELETE /api/competitors/:id`. */
export function registerCompetitorRoutes(app: FastifyInstance, competitorService: CompetitorService): void {
  app.get("/api/competitors", async () => {
    return (await competitorService.listTracked()).map(toCompetitorDto);
  });

  app.post("/api/competitors", async (request, reply) => {
    const { id } = CreateCompetitorBody.parse(request.body);
    const created = await competitorService.startTracking(id);
    return reply.code(201).send(toCompetitorDto(created));
  });

  app.delete<{ Params: { id: string } }>("/api/competitors/:id", async (request, reply) => {
    await competitorService.stopTracking(CompetitorId.parse(request.params.id));
    return reply.code(204).send();
  });
}
