import { z } from "zod";

// Decision 1.3: ids are trimmed and lowercased, then must be 1–64 chars of
// a-z, 0-9 and "-". The same rule applies to POST bodies and DELETE params,
// so " ACME-crm " and "acme-crm" always refer to the same competitor.
export const COMPETITOR_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export const CompetitorId = z
  .string({ error: "id must be a string" })
  .trim()
  .toLowerCase()
  .regex(COMPETITOR_ID_PATTERN, {
    error: "id must be 1–64 characters: lowercase letters, digits or '-'",
  });

export const CreateCompetitorBody = z.object({ id: CompetitorId });
