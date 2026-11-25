/** In-memory ApiClient backed by the JSON files in this folder. Mutations change memory only (lost on restart). */
import {
  AuditEventSchema,
  ReceiptSchema,
  RecordingSchema,
  RepairProposalSchema,
  RunSchema,
  SiteSchema,
  ToolSchema,
  canonicalJson,
  type Receipt,
  type RepairProposal,
  type Run,
  type Tool,
} from "@mcpify/contracts";
import { ApiError, type ApiClient } from "../lib/api";
import auditJson from "./audit.json";
import receiptsJson from "./receipts.json";
import recordingsJson from "./recordings.json";
import repairsJson from "./repairs.json";
import runsJson from "./runs.json";
import sitesJson from "./sites.json";
import toolsJson from "./tools.json";

/** Fresh, contract-validated copies of the mock data. */
export function loadMockData() {
  return {
    sites: SiteSchema.array().parse(sitesJson),
    tools: toolsJson.map((t) => ({ versions: ToolSchema.array().parse(t.versions) })),
    recordings: RecordingSchema.array().parse(recordingsJson),
    runs: RunSchema.array().parse(runsJson),
    receipts: ReceiptSchema.array().parse(receiptsJson),
    repairs: RepairProposalSchema.array().parse(repairsJson),
    audit: AuditEventSchema.array().parse(auditJson),
  };
}

function notFound(what: string, id: string): never {
  throw new ApiError(`${what} ${id} not found`, 404);
}

const latest = (versions: Tool[]): Tool => {
  const last = versions[versions.length - 1];
  if (!last) throw new ApiError("tool has no versions", 500);
  return last;
};

export function createMockClient(data = loadMockData()): ApiClient {
  const toolEntry = (id: string) => data.tools.find((t) => latest(t.versions).id === id) ?? notFound("tool", id);
  const run = (id: string): Run => data.runs.find((r) => r.id === id) ?? notFound("run", id);
  const repair = (id: string): RepairProposal => data.repairs.find((r) => r.id === id) ?? notFound("repair", id);

  function setStatus(id: string, status: Tool["status"]): Tool {
    const entry = toolEntry(id);
    const updated = { ...latest(entry.versions), status, updatedAt: new Date().toISOString() };
    entry.versions[entry.versions.length - 1] = updated;
    return updated;
  }

  return {
    health: async () => true,
    listSites: async () => data.sites,
    listTools: async (q = {}) =>
      data.tools
        .map((t) => latest(t.versions))
        .filter((t) => (!q.siteId || t.siteId === q.siteId) && (!q.status || t.status === q.status)),
    getTool: async (id) => latest(toolEntry(id).versions),
    getToolVersion: async (id, v) =>
      toolEntry(id).versions.find((t) => t.version === v) ?? notFound("tool version", `${id}@${v}`),
    approveTool: async (id) => setStatus(id, "approved"),
    disableTool: async (id) => setStatus(id, "disabled"),
    getRecording: async (id) => data.recordings.find((r) => r.id === id) ?? notFound("recording", id),
    listRuns: async (q = {}) =>
      data.runs
        .filter((r) => !q.toolId || r.toolId === q.toolId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, q.limit ?? 50),
    getRun: async (id) => run(id),
    continueRun: async (id, body) => {
      const r = run(id);
      if (!r.need) throw new ApiError("run is not waiting", 409);
      const stopped = body.approve === false;
      // The mock engine does not execute further; it only records that the paused step was answered.
      for (const t of r.trace) if (t.status === "awaiting") t.status = stopped ? "skipped" : "passed";
      Object.assign(r, { status: stopped ? "stopped" : "running", need: undefined, endedAt: stopped ? new Date().toISOString() : undefined });
      return r;
    },
    cancelRun: async (id) => Object.assign(run(id), { status: "stopped", need: undefined, endedAt: new Date().toISOString() }),
    getReceipt: async (id) => data.receipts.find((r) => r.id === id) ?? notFound("receipt", id),
    verifyReceipt: async (receipt: Receipt) => {
      const stored = data.receipts.find((r) => r.id === receipt.id);
      return { valid: !!stored && canonicalJson(stored) === canonicalJson(receipt) };
    },
    listAudit: async (q = {}) =>
      data.audit
        .filter((e) => !q.siteId || e.siteId === q.siteId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, q.limit ?? 200),
    listRepairs: async (status) => data.repairs.filter((r) => !status || r.status === status),
    approveRepair: async (id) => {
      const proposal = repair(id);
      const entry = toolEntry(proposal.toolId);
      const prev = latest(entry.versions);
      const tool: Tool = {
        ...prev,
        version: prev.version + 1,
        updatedAt: new Date().toISOString(),
        steps: prev.steps.map((s) => (s.id === proposal.stepId ? proposal.proposedStep : s)),
      };
      entry.versions.push(tool);
      proposal.status = "approved";
      return { proposal, tool };
    },
    rejectRepair: async (id) => Object.assign(repair(id), { status: "rejected" as const }),
  };
}
