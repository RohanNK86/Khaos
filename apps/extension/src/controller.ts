import { RunSchema, type Run, type Tool } from "@mcpify/contracts";
import { runTool, type Driver, type RunHooks } from "@mcpify/engine";
import { newRunId } from "@mcpify/engine/dom";
import type { Guard } from "./guard.js";
import type { RunSafety } from "./policy.js";

export interface ControllerDeps {
  driver: Driver;
  guard: Guard;
  /** Show/hide the page banner explicitly (the driver also re-sends it on every call). */
  banner(on: boolean): Promise<void>;
  report(run: Run): Promise<string | null>;
}

export interface RunResult {
  run: Run;
  blocked: number;
  reportId: string | null;
}

/** One run in the user's tab: guard + banner around the verified engine, then report. */
export async function executeRun(
  tool: Tool, inputs: Record<string, unknown>, safety: RunSafety, deps: ControllerDeps, hooks: RunHooks, signal?: AbortSignal,
): Promise<RunResult> {
  if (safety.strictGuard) await deps.guard.arm();
  if (safety.dryRun) await deps.banner(true).catch(() => undefined);
  let run: Run;
  try {
    run = await runTool(tool, inputs, deps.driver, hooks, { dryRun: safety.dryRun, mode: "user", runId: newRunId(), signal });
  } finally {
    if (safety.strictGuard) await deps.guard.disarm().catch(() => undefined);
    await deps.banner(false).catch(() => undefined);
  }
  const blocked = safety.strictGuard ? await deps.guard.count() : 0;
  return { run, blocked, reportId: await deps.report(run) };
}

/** POST /runs/report (validated); null when the API is unreachable. */
export async function reportRun(apiBase: string, run: Run, f: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await f(`${apiBase}/runs/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(RunSchema.parse(run)) });
    if (!r.ok) return null;
    const out = (await r.json()) as { id?: unknown };
    return typeof out.id === "string" ? out.id : null;
  } catch {
    return null;
  }
}
