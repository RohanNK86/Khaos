import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { notFound } from "../http.js";
import { p } from "../paths.js";

/** GET /static/mcpify.js: the owner script tag bundle, built by packages/agent-ready. */
export function staticRoutes(app: FastifyInstance, file = p("packages/agent-ready/dist/mcpify.js")): void {
  app.get("/static/mcpify.js", async (_req, reply) => {
    const js = await readFile(file).catch(() => undefined);
    if (!js) throw notFound("mcpify.js (build packages/agent-ready first)");
    return reply.type("application/javascript; charset=utf-8").header("cache-control", "no-cache").send(js);
  });
}
