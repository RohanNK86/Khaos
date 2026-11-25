import type { Receipt, Run, Tool } from "@mcpify/contracts";
import { issueReceipt, type Signer } from "@mcpify/storage";
import { HttpError } from "./http.js";
import type { Store } from "./store.js";

/** True when the run succeeded and actually executed at least one commit step. */
export function executedCommit(run: Run, tool: Tool): boolean {
  const commits = new Set(tool.steps.filter((s) => s.risk === "commit").map((s) => s.id));
  return run.status === "succeeded" && run.trace.some((t) => t.status === "passed" && commits.has(t.stepId));
}

/** Issue (or return the existing) signed receipt for a run. */
export async function issueForRun(store: Store, signer: Signer, run: Run, tool: Tool, inputs: Record<string, unknown>): Promise<Receipt> {
  const existing = await store.receiptOfRun(run.id);
  if (existing) return existing;
  if (!executedCommit(run, tool)) throw new HttpError(409, "receipts are only issued for succeeded runs that sent something (a commit step)");
  const site = await store.getSite(tool.siteId);
  const receipt = await issueReceipt(signer, tool, run, inputs, site?.origin ?? "");
  await store.saveReceipt(receipt);
  await store.audit({ siteId: tool.siteId, toolId: tool.id, runId: run.id, actor: "system", action: "receipt.issued", detail: receipt.id });
  return receipt;
}
