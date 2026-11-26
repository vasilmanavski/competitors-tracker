import { z } from "zod";

export const COMPETITOR_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * A competitor id, normalised before validation (trimmed, lowercased), so
 * " ACME-crm " and "acme-crm" always name the same competitor.
 */
export const CompetitorId = z
  .string({ error: "id must be a string" })
  .trim()
  .toLowerCase()
  .regex(COMPETITOR_ID_PATTERN, {
    error: "id must be 1–64 characters: lowercase letters, digits or '-'",
  });

export const CreateCompetitorBody = z.object({ id: CompetitorId });
