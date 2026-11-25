import type { Run, Tool } from "@mcpify/contracts";
import { repairStep } from "@mcpify/repair";
import type { BlobStore } from "@mcpify/storage";
import { fileRepair } from "../routes/repairs.js";
import type { Store } from "../store.js";
import type { RepairHandler } from "./repair-hook.js";

/**
 * Verified Selective Repair wired into live runs:
 * failed step → repairStep (fallback → heuristic → LLM → dry-run sandbox) → POST-/repairs rule.
 * auto_applied → the tool becomes v+1 and the SAME run continues from the repaired step.
 * pending → run ends as repair_pending (owner decides). needs_rerecord → run stays failed.
 */
export function createSelfRepairHandler(store: Store, blobs: BlobStore): RepairHandler {
  return async (run, tool, evidence, ctx) => {
    if (!ctx || !evidence.stepId || !evidence.domSnapshotBlobId) return run;
    const blob = await blobs.get(evidence.domSnapshotBlobId);
    if (!blob) return run;
    console.log(`[repair] run ${run.id}: step ${evidence.stepId} failed, trying selective repair`);
    const draft = await repairStep({
      tool, failedStepId: evidence.stepId, evidenceHtml: blob.content.toString("utf8"),
      evidenceBlobId: evidence.domSnapshotBlobId, failedChecks: evidence.failedChecks,
      browser: ctx.browser, sandbox: { inputs: ctx.inputs, loadFile: ctx.loadFile, browser: ctx.browser },
    });
    const proposal = await fileRepair(store, draft);
    console.log(`[repair] run ${run.id}: ${proposal.method} confidence ${proposal.confidence} → ${proposal.status}`);
    await store.audit({ siteId: tool.siteId, toolId: tool.id, runId: run.id, actor: "system", action: "repair.attempted", detail: `${proposal.id}: ${proposal.status}` });
    if (proposal.status === "needs_rerecord") return run;
    if (proposal.status !== "auto_applied") return { ...run, status: "repair_pending" };
    const patched = await store.latestTool(tool.id);
    if (!patched) return run;
    const startIndex = patched.steps.findIndex((s) => s.id === proposal.stepId);
    return ctx.retry(patched as Tool, startIndex) as Promise<Run>;
  };
}
