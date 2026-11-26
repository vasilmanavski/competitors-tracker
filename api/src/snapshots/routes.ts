import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CompetitorId } from "../competitors/competitor-id.ts";
import { toSnapshotDto } from "./dto.ts";
import type { SnapshotService } from "./service.ts";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

const TimelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  before: z.iso.datetime({ offset: true }).optional(),
});

/** `GET /api/competitors/:id/snapshots?limit=&before=` (newest first). */
export function registerSnapshotRoutes(app: FastifyInstance, snapshotService: SnapshotService): void {
  app.get<{ Params: { id: string }; Querystring: unknown }>("/api/competitors/:id/snapshots", async (request) => {
    const id = CompetitorId.parse(request.params.id);
    const { limit, before } = TimelineQuery.parse(request.query);
    const rows = await snapshotService.listTimeline(id, { limit, before: before ? new Date(before) : undefined });
    return rows.map(toSnapshotDto);
  });
}
