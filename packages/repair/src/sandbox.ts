import type { Browser } from "playwright";
import type { Tool } from "@mcpify/contracts";
import { runTool, type RunHooks } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";

export interface SandboxOptions {
  /** Recorded / example inputs for the replay. */
  inputs: Record<string, unknown>;
  loadFile?: RunHooks["loadFile"];
  /** Reuse a browser; otherwise the caller's analysis browser is used. */
  browser?: Browser;
}

/** Point the tool at another origin (e.g. a portal on a test port). */
export function retargetTool(tool: Tool, portalUrl: string): Tool {
  const from = new URL(tool.startUrl).origin;
  const to = new URL(portalUrl).origin;
  return from === to ? tool : (JSON.parse(JSON.stringify(tool).replaceAll(from, to)) as Tool);
}

/**
 * Replay the patched tool from the start up to and including `stepId` in a fresh context, in engine
 * dry-run (commit steps are blocked, nothing is sent). Auth prompts are never answered.
 * passed = the repaired step ran with all its pre- and postconditions holding.
 */
export async function runSandbox(
  browser: Browser, tool: Tool, stepId: string, opts: SandboxOptions,
): Promise<{ passed: boolean; detail: string }> {
  const idx = tool.steps.findIndex((s) => s.id === stepId);
  const truncated: Tool = { ...tool, steps: tool.steps.slice(0, idx + 1) };
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const run = await runTool(truncated, opts.inputs, createPlaywrightDriver(page), {
      onNeed: async () => ({}), // never approve a commit, never invent OTP/CAPTCHA
      loadFile: opts.loadFile,
    }, { dryRun: true, mode: "owner" });
    const t = run.trace.find((x) => x.stepId === stepId);
    if (t?.status === "passed") {
      const ok = (rs: { ok: boolean }[]) => `${rs.filter((r) => r.ok).length}/${rs.length}`;
      return { passed: true, detail: `dry-run replay of ${idx + 1} steps: ${stepId} passed (pre ${ok(t.preResults)}, post ${ok(t.postResults)}) via ${t.usedLocator?.kind ?? "-"}` };
    }
    const last = run.trace.at(-1);
    if (t) return { passed: false, detail: `dry-run replay: ${stepId} ${t.status}${t.error ? `: ${t.error}` : ""}` };
    return { passed: false, detail: `dry-run replay stopped before ${stepId} (${run.status} at ${last?.stepId ?? "start"}${last?.error ? `: ${last.error}` : ""})` };
  } finally {
    await ctx.close();
  }
}
