import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RunModeSchema, RunSchema, type Run } from "@mcpify/contracts";
import type { Ctx } from "../context.js";
import { HttpError, IdParams, Limit, found, parse } from "../http.js";
import { prepareInputs } from "../runs/inputs.js";
import { mustTool } from "../tools-service.js";

const StartBody = z.object({
  toolId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  mode: RunModeSchema.default("owner"),
  dryRun: z.boolean().default(false),
});
const ContinueBody = z.object({ approve: z.boolean().optional(), value: z.string().optional() });
const ListQuery = z.object({ toolId: z.string().optional(), limit: Limit });

/** Server-side runs (01-CONTRACTS §11, §8). Every call returns at the next pause or terminal state. */
export function runRoutes(app: FastifyInstance, { store, runs }: Ctx): void {
  app.post("/runs", async (req) => {
    const body = parse(StartBody, req.body);
    const tool = await mustTool(store, body.toolId);
    if (tool.status !== "approved") throw new HttpError(409, `tool ${tool.name} is ${tool.status}; only approved tools can run`);
    const site = found(await store.getSite(tool.siteId), `site ${tool.siteId}`);
    const { inputs, errors } = prepareInputs(tool, body.inputs);
    if (errors.length) throw new HttpError(400, `Please fix the inputs: ${errors.join("; ")}`, errors);
    return runs.start({ tool, site, inputs, mode: body.mode, dryRun: body.dryRun });
  });

  app.post("/runs/report", async (req) => {
    const run = parse(RunSchema, req.body, "run");
    const tool = await mustTool(store, run.toolId);
    await store.saveRun(run);
    await store.audit({ siteId: tool.siteId, toolId: tool.id, runId: run.id, actor: run.mode === "user" ? "user" : "agent", action: "run.reported", detail: run.status });
    return { id: run.id };
  });

  app.get("/runs", async (req) => {
    const q = parse(ListQuery, req.query, "query");
    return mergeLive(await store.listRuns(q), runs.liveRuns(), q);
  });

  app.get("/runs/:id", async (req) => {
    const { id } = parse(IdParams, req.params, "params");
    return runs.get(id) ?? found(await store.getRun(id), `run ${id}`);
  });

  /** Not in §11: requests the dry-run network guard blocked (live run view). */
  app.get("/runs/:id/blocked", async (req) => runs.blockedOf(parse(IdParams, req.params, "params").id));

  app.post("/runs/:id/continue", async (req) => {
    const { id } = parse(IdParams, req.params, "params");
    return runs.continue(id, parse(ContinueBody, req.body ?? {}));
  });

  app.post("/runs/:id/cancel", async (req) => runs.cancel(parse(IdParams, req.params, "params").id));
}

/** Stored runs, with the in-memory copy winning for runs this process is executing (it is never behind). */
function mergeLive(stored: Run[], live: Run[], q: { toolId?: string; limit: number }): Run[] {
  const byId = new Map(stored.map((r) => [r.id, r]));
  for (const r of live) if (!q.toolId || r.toolId === q.toolId) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, q.limit);
}
