import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

/** A requested resource does not exist. Mapped to HTTP 404. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** The request conflicts with the current state. Mapped to HTTP 409. */
export class ConflictError extends Error {
  override name = "ConflictError";
}

const INTERNAL_ERROR_MESSAGE = "internal error";

/**
 * Maps validation and domain errors to HTTP responses, so routes can just throw.
 * Every error body is `{ message }`, which the UI shows as-is.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ message: error.issues[0]?.message ?? "invalid request" });
    }
    if (error instanceof NotFoundError) return reply.code(404).send({ message: error.message });
    if (error instanceof ConflictError) return reply.code(409).send({ message: error.message });

    const statusCode = clientErrorStatus(error);
    if (statusCode !== null) return reply.code(statusCode).send({ message: (error as Error).message });

    request.log.error(error);
    return reply.code(500).send({ message: INTERNAL_ERROR_MESSAGE });
  });
}

function clientErrorStatus(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : null;
}
