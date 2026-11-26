import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CompetitorId } from "../competitors/competitor-id.ts";
import type { CompetitorRepository } from "../competitors/repository.ts";
import { formatPrice } from "../listings/normalize.ts";
import { priceOf, type Snapshot, type SnapshotRepository } from "./repository.ts";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.iso.datetime({ offset: true }).optional(),
});

// `price` is a canonical display string when we understood the price ("$39/mo"),
// otherwise the source's own (cleaned) wording. The parsed parts are in priceDetail.
export const toSnapshotDto = (s: Snapshot) => {
  const price = priceOf(s);
  return {
    id: s.id,
    fetchedAt: s.fetchedAt.toISOString(),
    status: s.status,
    title: s.title,
    tagline: s.tagline,
    price: price ? formatPrice(price) : s.priceText,
    priceDetail: price,
    priceRaw: s.priceText,
    description: s.description,
    changed: s.changed,
    changedFields: s.changedFields,
    missingFields: s.missingFields,
    summary: s.summary,
    summaryStatus: s.summaryStatus,
    error: s.error,
  };
};

export function snapshotRoutes(app: FastifyInstance, snapshots: SnapshotRepository, competitors: CompetitorRepository) {
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/competitors/:id/snapshots",
    async (request, reply) => {
      const id = CompetitorId.safeParse(request.params.id);
      if (!id.success) return reply.code(400).send({ message: id.error.issues[0]?.message ?? "invalid id" });
      const query = Query.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ message: query.error.issues[0]?.message ?? "invalid query" });
      }
      // 404 for an untracked id, so the UI can tell "removed" from "no polls yet" ([]).
      if (!(await competitors.exists(id.data))) {
        return reply.code(404).send({ message: `${id.data} is not tracked` });
      }
      const rows = await snapshots.list(id.data, {
        limit: query.data.limit,
        before: query.data.before ? new Date(query.data.before) : undefined,
      });
      return rows.map(toSnapshotDto);
    },
  );
}
