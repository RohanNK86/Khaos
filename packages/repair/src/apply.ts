import type { Browser } from "playwright";
import { ToolSchema, type RepairProposal, type Run, type Tool } from "@mcpify/contracts";
import type { RunHooks } from "@mcpify/engine";
import { repairStep, type RepairDraft } from "./repair.js";

/** Replace the proposal's step in the tool: version + 1, new updatedAt. Throws on a stale or foreign proposal. */
export function applyProposal(tool: Tool, proposal: Pick<RepairProposal, "toolId" | "fromVersion" | "stepId" | "proposedStep">): Tool {
  if (proposal.toolId !== tool.id) throw new Error(`proposal is for tool ${proposal.toolId}, not ${tool.id}`);
  if (proposal.fromVersion !== tool.version) throw new Error(`proposal is for version ${proposal.fromVersion}, tool is at ${tool.version}`);
  if (!tool.steps.some((s) => s.id === proposal.stepId)) throw new Error(`step ${proposal.stepId} not in tool`);
  if (proposal.proposedStep.id !== proposal.stepId) throw new Error("a repair may not rename the step");
  const next: Tool = {
    ...tool,
    version: tool.version + 1,
    updatedAt: new Date().toISOString(),
    steps: tool.steps.map((s) => (s.id === proposal.stepId ? proposal.proposedStep : s)),
  };
  return ToolSchema.parse(next) as Tool;
}

/** Failed checks of the failed step, as plain sentences for RepairProposal.evidence.failedChecks. */
export function failedChecksFromRun(run: Run): string[] {
  const t = run.trace.find((x) => x.stepId === run.failedStepId && x.status === "failed");
  if (!t) return [];
  const checks = [...t.preResults, ...t.postResults].filter((r) => !r.ok).map((r) => r.detail ?? "check failed");
  return [...new Set([...(t.error ? [t.error] : []), ...checks])];
}

export interface RepairAndRetryArgs {
  run: Run;
  tool: Tool;
  /** Evidence HTML (the content of run.trace[failed].evidenceBlobId). */
  evidenceHtml: string;
  /** Inputs of the failed run (unredacted, server-side only); used for the dry-run sandbox. */
  inputs: Record<string, unknown>;
  loadFile?: RunHooks["loadFile"];
  browser?: Browser;
  portalUrl?: string;
  /** Re-run the patched tool (e.g. RunManager resumes from the failed step). Called only after auto-apply. */
  retry?: (patched: Tool, startIndex: number) => Promise<Run>;
}

export interface RepairAndRetryResult {
  proposal: RepairDraft;
  /** The patched tool (version + 1) when the proposal was auto-applied. */
  patched?: Tool;
  retried?: Run;
}

/**
 * Convenience for RunManager.onStepFailed(run, tool, evidence): repair the failed step, and when the
 * proposal is auto_applied, patch the tool and (optionally) retry. The caller still POSTs the proposal to
 * /repairs (the API re-checks the auto-apply rule) and sets run status "repair_pending" otherwise.
 */
export async function repairAndRetry(a: RepairAndRetryArgs): Promise<RepairAndRetryResult> {
  if (!a.run.failedStepId) throw new Error("run has no failed step");
  const evidenceBlobId = a.run.trace.find((t) => t.stepId === a.run.failedStepId)?.evidenceBlobId;
  const proposal = await repairStep({
    tool: a.tool, failedStepId: a.run.failedStepId, evidenceHtml: a.evidenceHtml, evidenceBlobId,
    failedChecks: failedChecksFromRun(a.run), portalUrl: a.portalUrl, browser: a.browser,
    sandbox: { inputs: a.inputs, loadFile: a.loadFile, browser: a.browser },
  });
  if (proposal.status !== "auto_applied") return { proposal };
  const patched = applyProposal(a.tool, proposal);
  const startIndex = patched.steps.findIndex((s) => s.id === proposal.stepId);
  return { proposal, patched, retried: a.retry ? await a.retry(patched, startIndex) : undefined };
}
