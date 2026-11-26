import type { FastifyInstance } from "fastify";
import { CompetitorId, CreateCompetitorBody } from "./competitor-id.ts";
import { toCompetitorDto } from "./dto.ts";
import type { CompetitorService } from "./service.ts";

/** `GET/POST /api/competitors` and `DELETE /api/competitors/:id`. */
export function registerCompetitorRoutes(app: FastifyInstance, competitors: CompetitorService): void {
  app.get("/api/competitors", async () => {
    return (await competitors.list()).map(toCompetitorDto);
  });

  app.post("/api/competitors", async (request, reply) => {
    const { id } = CreateCompetitorBody.parse(request.body);
    const created = await competitors.add(id);
    return reply.code(201).send(toCompetitorDto(created));
  });

  app.delete<{ Params: { id: string } }>("/api/competitors/:id", async (request, reply) => {
    await competitors.remove(CompetitorId.parse(request.params.id));
    return reply.code(204).send();
  });
}
