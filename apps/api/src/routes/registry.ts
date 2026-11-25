import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecordingSchema, SiteSchema, StepContractSchema, ToolStatusSchema } from "@mcpify/contracts";
import type { Ctx } from "../context.js";
import { HttpError, IdParams, Limit, found, notFound, parse } from "../http.js";
import { approveTool, createTool, disableTool, mustTool, patchTool } from "../tools-service.js";

const NewSite = SiteSchema.omit({ id: true });
const ToolQuery = z.object({ siteId: z.string().optional(), status: ToolStatusSchema.optional() });
const VersionParams = z.object({ id: z.string().min(1), v: z.coerce.number().int().min(1) });
const PatchBody = z.object({ stepId: z.string().min(1), step: StepContractSchema, reason: z.string().min(1) });
const AuditQuery = z.object({ siteId: z.string().optional(), limit: Limit });

/** Health, sites, recordings, tools, audit (01-CONTRACTS §11). */
export function registryRoutes(app: FastifyInstance, { store }: Ctx): void {
  app.get("/health", async () => ({ ok: true }));

  app.post("/sites", async (req) => {
    const body = parse(NewSite, req.body);
    const existing = await store.siteByOrigin(body.origin);
    const bySlug = await store.siteBySlug(body.slug);
    if (bySlug && bySlug.origin !== body.origin) throw new HttpError(409, `slug ${body.slug} is already used by ${bySlug.origin}`);
    const site = await store.putSite({ ...body, id: existing?.id ?? randomUUID() });
    await store.audit({ siteId: site.id, actor: "owner", action: existing ? "site.updated" : "site.created", detail: site.origin });
    return site;
  });

  app.get("/sites", async () => store.listSites());

  app.get("/sites/manifest", async (req) => {
    const { origin } = parse(z.object({ origin: z.string().min(1) }), req.query, "query");
    const site = await store.siteByOrigin(origin.replace(/\/$/, ""));
    if (!site) throw notFound(`site with origin ${origin}`);
    return { site, tools: await store.listLatestTools({ siteId: site.id, status: "approved" }) };
  });

  app.post("/recordings", async (req) => {
    const rec = parse(RecordingSchema, req.body, "recording");
    await store.putRecording(rec);
    return { id: rec.id };
  });

  app.get("/recordings/:id", async (req) => {
    const { id } = parse(IdParams, req.params, "params");
    return found(await store.getRecording(id), `recording ${id}`);
  });

  app.post("/tools", async (req) => createTool(store, parse(z.record(z.string(), z.unknown()), req.body, "tool")));

  app.get("/tools", async (req) => store.listLatestTools(parse(ToolQuery, req.query, "query")));

  app.get("/tools/:id", async (req) => mustTool(store, parse(IdParams, req.params, "params").id));

  app.get("/tools/:id/versions/:v", async (req) => {
    const { id, v } = parse(VersionParams, req.params, "params");
    return found(await store.toolVersion(id, v), `tool ${id} v${v}`);
  });

  app.post("/tools/:id/approve", async (req) => approveTool(store, parse(IdParams, req.params, "params").id));

  app.post("/tools/:id/disable", async (req) => disableTool(store, parse(IdParams, req.params, "params").id));

  app.post("/tools/:id/patch", async (req) => {
    const { id } = parse(IdParams, req.params, "params");
    const { stepId, step, reason } = parse(PatchBody, req.body);
    return patchTool(store, id, stepId, step, reason);
  });

  app.get("/audit", async (req) => store.listAudit(parse(AuditQuery, req.query, "query")));
}
