import { randomUUID } from "node:crypto";
import { ToolSchema, type AuditEvent, type StepContract, type Tool } from "@mcpify/contracts";
import { HttpError, notFound } from "./http.js";
import type { Store } from "./store.js";

type Actor = AuditEvent["actor"];

export async function mustTool(store: Store, id: string): Promise<Tool> {
  const tool = await store.latestTool(id);
  if (!tool) throw notFound(`tool ${id}`);
  return tool;
}

/** POST /tools: a new draft at version 1. Server-owned fields in the body are ignored. */
export async function createTool(store: Store, body: Record<string, unknown>): Promise<Tool> {
  const { id: _id, version: _v, status: _s, createdAt: _c, updatedAt: _u, ...rest } = body;
  const now = new Date().toISOString();
  const parsed = ToolSchema.safeParse({ outputs: [], ...rest, id: randomUUID(), version: 1, status: "draft", createdAt: now, updatedAt: now });
  if (!parsed.success) throw new HttpError(400, "invalid tool", parsed.error.issues);
  const tool = parsed.data;
  if (!(await store.getSite(tool.siteId))) throw new HttpError(400, `unknown siteId ${tool.siteId}`);
  await store.insertToolVersion(tool);
  await store.audit({ siteId: tool.siteId, toolId: tool.id, actor: "owner", action: "tool.created", detail: `${tool.name} v1 (${tool.steps.length} steps)` });
  return tool;
}

/** Approve the latest version; any other approved tool with the same site + name is disabled (the new one replaces it). */
export async function approveTool(store: Store, id: string): Promise<Tool> {
  const tool = await mustTool(store, id);
  const rivals = await store.listLatestTools({ siteId: tool.siteId, status: "approved" });
  for (const other of rivals.filter((t) => t.name === tool.name && t.id !== tool.id)) {
    await store.setToolStatus(other, "disabled");
    await store.audit({ siteId: other.siteId, toolId: other.id, actor: "system", action: "tool.disabled", detail: `replaced by ${tool.id}` });
  }
  const next = await store.setToolStatus(tool, "approved");
  await store.audit({ siteId: tool.siteId, toolId: tool.id, actor: "owner", action: "tool.approved", detail: `${tool.name} v${tool.version}` });
  return next;
}

export async function disableTool(store: Store, id: string): Promise<Tool> {
  const tool = await mustTool(store, id);
  const next = await store.setToolStatus(tool, "disabled");
  await store.audit({ siteId: tool.siteId, toolId: tool.id, actor: "owner", action: "tool.disabled", detail: `${tool.name} v${tool.version}` });
  return next;
}

/** Replace one step → new version (version+1, same status). */
export async function patchTool(store: Store, id: string, stepId: string, step: StepContract, reason: string, actor: Actor = "owner"): Promise<Tool> {
  const tool = await mustTool(store, id);
  if (!tool.steps.some((s) => s.id === stepId)) throw new HttpError(400, `tool ${id} has no step ${stepId}`);
  const parsed = ToolSchema.safeParse({
    ...tool,
    version: tool.version + 1,
    updatedAt: new Date().toISOString(),
    steps: tool.steps.map((s) => (s.id === stepId ? step : s)),
  });
  if (!parsed.success) throw new HttpError(400, "patched tool is invalid", parsed.error.issues);
  await store.insertToolVersion(parsed.data);
  await store.audit({ siteId: tool.siteId, toolId: tool.id, actor, action: "tool.patched", detail: `step ${stepId} → v${parsed.data.version}: ${reason}` });
  return parsed.data;
}
