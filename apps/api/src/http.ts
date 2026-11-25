import type { FastifyError, FastifyInstance } from "fastify";
import { z } from "zod";

/** An error with an HTTP status; rendered as `{ error, details? }`. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Validate an external input with a Zod schema; 400 with the issues on failure. */
export function parse<S extends z.ZodType>(schema: S, value: unknown, what = "request body"): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, `invalid ${what}`, r.error.issues);
  return r.data;
}

export const IdParams = z.object({ id: z.string().min(1) });
export const Limit = z.coerce.number().int().min(1).max(500).default(50);

/** Uniform `{ error, details }` responses for every failure. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const details = err instanceof HttpError ? err.details : undefined;
    void reply.status(status).send({ error: status >= 500 && !(err instanceof HttpError) ? "internal error" : err.message, ...(details !== undefined ? { details } : {}) });
  });
  app.setNotFoundHandler((req, reply) => {
    void reply.status(404).send({ error: `no route ${req.method} ${req.url}` });
  });
}

/** The value, or a 404 for `what`. */
export function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw notFound(what);
  return value;
}
