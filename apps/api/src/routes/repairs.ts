import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepairProposalSchema, type RepairProposal, type Tool } from "@mcpify/contracts";
import type { Ctx } from "../context.js";
import { HttpError, IdParams, found, parse } from "../http.js";
import type { Store } from "../store.js";
import { mustTool, patchTool } from "../tools-service.js";

const NewRepair = RepairProposalSchema.omit({ id: true, createdAt: true });
const StatusQuery = z.object({ status: RepairProposalSchema.shape.status.optional() });
const SAFE_RISKS = new Set(["read", "fill"]);

/**
 * Auto-apply rule (01-CONTRACTS §10): risk ∈ {read, fill} (for both the current and the proposed step)
 * AND sandbox passed AND confidence ≥ 0.8 → auto_applied. A proposal marked needs_rerecord stays so.
 */
export function decideRepairStatus(p: Omit<RepairProposal, "id" | "createdAt">, tool: Tool): RepairProposal["status"] {
  if (p.status === "needs_rerecord") return "needs_rerecord";
  const current = tool.steps.find((s) => s.id === p.stepId);
  const safe = !!current && SAFE_RISKS.has(current.risk) && SAFE_RISKS.has(p.proposedStep.risk);
  return safe && p.sandbox.passed && p.confidence >= 0.8 ? "auto_applied" : "pending";
}

async function applyProposal(store: Store, p: RepairProposal, actor: "system" | "owner"): Promise<Tool> {
  return patchTool(store, p.toolId, p.stepId, p.proposedStep, `repair ${p.id} (${p.method}, confidence ${p.confidence}): ${p.reason}`, actor);
}

/** Repair proposals (01-CONTRACTS §10, §11). */
export function repairRoutes(app: FastifyInstance, { store }: Ctx): void {
  app.post("/repairs", async (req) => fileRepair(store, parse(NewRepair, req.body, "repair proposal")));

  app.get("/repairs", async (req) => store.listRepairs(parse(StatusQuery, req.query, "query").status));

  app.post("/repairs/:id/approve", async (req) => {
    const proposal = await mustPending(store, parse(IdParams, req.params, "params").id);
    const tool = await applyProposal(store, proposal, "owner");
    const next: RepairProposal = { ...proposal, status: "approved" };
    await store.saveRepair(next);
    await store.audit({ siteId: tool.siteId, toolId: tool.id, actor: "owner", action: "repair.approved", detail: `${proposal.id} → v${tool.version}` });
    return { proposal: next, tool };
  });

  app.post("/repairs/:id/reject", async (req) => {
    const proposal = await mustPending(store, parse(IdParams, req.params, "params").id);
    const next: RepairProposal = { ...proposal, status: "rejected" };
    await store.saveRepair(next);
    const tool = await store.latestTool(proposal.toolId);
    await store.audit({ siteId: tool?.siteId ?? "", toolId: proposal.toolId, actor: "owner", action: "repair.rejected", detail: proposal.id });
    return next;
  });
}


/** Store a proposal, apply the auto-apply rule, and patch the tool when auto-applied (POST /repairs and self-repair). */
export async function fileRepair(store: Store, body: z.infer<typeof NewRepair>): Promise<RepairProposal> {
  const tool = await mustTool(store, body.toolId);
  if (!tool.steps.some((s) => s.id === body.stepId)) throw new HttpError(400, `tool ${tool.id} has no step ${body.stepId}`);
  const status = decideRepairStatus(body, tool);
  const proposal: RepairProposal = { ...body, id: randomUUID(), createdAt: new Date().toISOString(), status, reversible: SAFE_RISKS.has(body.proposedStep.risk) && body.reversible };
  await store.saveRepair(proposal);
  await store.audit({ siteId: tool.siteId, toolId: tool.id, actor: "system", action: "repair.created", detail: `${proposal.id} step ${proposal.stepId}: ${status}` });
  if (status === "auto_applied") await applyProposal(store, proposal, "system");
  return proposal;
}
async function mustPending(store: Store, id: string): Promise<RepairProposal> {
  const p = found(await store.getRepair(id), `repair ${id}`);
  if (p.status !== "pending") throw new HttpError(409, `repair ${id} is ${p.status}, not pending`);
  return p;
}
