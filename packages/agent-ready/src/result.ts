import type { Run, ToolCallResult } from "@mcpify/contracts";

const MESSAGES: Record<Run["status"], string> = {
  running: "The task is still running.",
  awaiting_confirmation: "Waiting for the user to confirm on the page.",
  awaiting_user_input: "Waiting for the user to type a value on the page.",
  succeeded: "Done. Every step was verified on the page.",
  failed: "The task stopped safely because a check failed. Nothing after that step was done.",
  repair_pending: "The task needs a repair by the site owner.",
  stopped: "The task was stopped by the user.",
  dry_run_complete: "Dry run finished: the form was filled but nothing was sent.",
};

/** Same shape the MCP server returns (01-CONTRACTS §12). */
export function toCallResult(run: Run): ToolCallResult {
  const failed = run.trace.find((t) => t.status === "failed");
  return {
    run_id: run.id,
    status: run.status,
    message: MESSAGES[run.status],
    ...(Object.keys(run.outputs).length ? { outputs: run.outputs } : {}),
    ...(failed?.error ? { error: `${failed.stepId}: ${failed.error}` } : {}),
  };
}
