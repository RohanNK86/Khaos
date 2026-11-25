import type { Run, Tool } from "@mcpify/contracts";

/** What a failed step left behind (DOM snapshot blob + the checks that failed). */
export interface StepFailureEvidence {
  stepId: string;
  domSnapshotBlobId?: string;
  failedChecks: string[];
}

/**
 * Called when a server-side run ends with status "failed". Returns the run to keep
 * (e.g. with status "repair_pending" after it filed a RepairProposal). Plug @mcpify/repair in here.
 */
export type RepairHandler = (run: Run, tool: Tool, evidence: StepFailureEvidence) => Promise<Run>;

const markFailed: RepairHandler = async (run) => run;
let handler: RepairHandler = markFailed;

/** Install the repair integration (pass null to restore the default: just mark the run failed). */
export function setRepairHandler(h: RepairHandler | null): void {
  handler = h ?? markFailed;
}

/** The hook the RunManager calls on every failed run. Handler errors never break the run. */
export async function onStepFailed(run: Run, tool: Tool, evidence: StepFailureEvidence): Promise<Run> {
  try {
    return await handler(run, tool, evidence);
  } catch (e) {
    console.error(`[repair] handler failed for run ${run.id}: ${(e as Error).message}`);
    return run;
  }
}

/** Collect evidence from the failed step of a run. */
export function evidenceOf(run: Run): StepFailureEvidence {
  const t = run.trace.find((x) => x.status === "failed");
  const checks = [...(t?.preResults ?? []), ...(t?.postResults ?? [])].filter((c) => !c.ok).map((c) => c.detail ?? "check failed");
  return {
    stepId: run.failedStepId ?? t?.stepId ?? "",
    domSnapshotBlobId: t?.evidenceBlobId,
    failedChecks: t?.error ? [...checks, t.error] : checks,
  };
}
