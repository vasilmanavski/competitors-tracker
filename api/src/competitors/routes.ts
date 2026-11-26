import type { FastifyInstance } from "fastify";
import type { z } from "zod";
import { CompetitorId, CreateCompetitorBody } from "./competitor-id.ts";
import type { Competitor, CompetitorRepository } from "./repository.ts";

// Error bodies are always { message }, so the UI can show them inline as-is.
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "invalid request";

const toDto = (c: Competitor) => ({ id: c.id, createdAt: c.createdAt.toISOString() });

export function competitorRoutes(app: FastifyInstance, repo: CompetitorRepository) {
  app.get("/api/competitors", async () => {
    const rows = await repo.list();
    return rows.map(toDto);
  });

  // Decision 1.2: we don't check the id against the source here. An unknown id
  // is accepted; polling (Epic 2) will record it as not_found in the timeline.
  app.post("/api/competitors", async (request, reply) => {
    const parsed = CreateCompetitorBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: firstIssue(parsed.error) });
    }
    const created = await repo.create(parsed.data.id);
    if (!created) {
      // Decision 1.4: duplicate add is a conflict, not a silent success.
      return reply.code(409).send({ message: `${parsed.data.id} is already tracked` });
    }
    return reply.code(201).send(toDto(created));
  });

  app.delete<{ Params: { id: string } }>("/api/competitors/:id", async (request, reply) => {
    const parsed = CompetitorId.safeParse(request.params.id);
    if (!parsed.success) {
      return reply.code(400).send({ message: firstIssue(parsed.error) });
    }
    // Decision 1.5: deleting an id that isn't tracked is a 404.
    const removed = await repo.remove(parsed.data);
    if (!removed) {
      return reply.code(404).send({ message: `${parsed.data} is not tracked` });
    }
    return reply.code(204).send();
  });
}
