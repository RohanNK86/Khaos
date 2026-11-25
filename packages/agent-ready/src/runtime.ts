import type { Run, Tool, ToolCallResult } from "@mcpify/contracts";
import type { RunHooks } from "@mcpify/engine";
import {
  clearRunState, loadRunState, resumeToolInPage, runToolInPage,
  type InPageInstaller, type RunStateStorage,
} from "@mcpify/engine/dom";
import { reportRun } from "./api.js";
import type { PauseUi } from "./modal.js";
import { toCallResult } from "./result.js";
import type { WebMcpTool } from "./webmcp-adapter.js";

export const LAST_RUN_KEY = "mcpify:last-run";
export const DRY_RUN_PARAM = "mcpify_dry_run";

export interface RuntimeDeps {
  doc: Document;
  apiBase: string;
  tools: Tool[];
  ui: PauseUi;
  storage: RunStateStorage;
  install?: InPageInstaller;
  fetch?: typeof fetch;
}

export interface Runtime {
  run(name: string, inputs: Record<string, unknown>): Promise<ToolCallResult>;
  /** Continue a run that a page reload interrupted; null when there is none. */
  resume(): Promise<ToolCallResult | null>;
  lastRun(): Promise<Run | null>;
  webMcpTool(tool: Tool): WebMcpTool;
}

export function createRuntime(d: RuntimeDeps): Runtime {
  const win = d.doc.defaultView!;
  const driver = { install: d.install, highlight: true };

  const hooksFor = (tool: Tool): RunHooks => ({
    onNeed: (n) => d.ui.onNeed(n, tool.title),
    loadFile: (ref) => d.ui.pickFile(ref),
    onStep: (t) => d.ui.status(`${tool.title}: ${t.stepId.replaceAll("_", " ")} ${t.status === "awaiting" ? "(waiting for you)" : t.status}`),
  });

  async function finish(run: Run): Promise<ToolCallResult> {
    d.ui.status(null);
    await d.storage.setItem(LAST_RUN_KEY, JSON.stringify(run));
    win.dispatchEvent(new win.CustomEvent("mcpify:run", { detail: run }));
    await reportRun(d.apiBase, run, d.fetch);
    return toCallResult(run);
  }

  const runtime: Runtime = {
    async run(name, inputs) {
      const tool = d.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`unknown tool "${name}" (available: ${d.tools.map((t) => t.name).join(", ")})`);
      const { [DRY_RUN_PARAM]: dry, ...rest } = inputs;
      const run = await runToolInPage(tool, rest, d.doc, hooksFor(tool), { dryRun: dry === true, mode: "owner", storage: d.storage, driver });
      return finish(run);
    },
    async resume() {
      const state = await loadRunState(d.storage);
      if (!state) return null;
      const tool = d.tools.find((t) => t.id === state.toolId);
      if (!tool) {
        await clearRunState(d.storage);
        return null;
      }
      return finish(await resumeToolInPage(tool, state, d.doc, hooksFor(tool), { storage: d.storage, driver }));
    },
    async lastRun() {
      const raw = await d.storage.getItem(LAST_RUN_KEY);
      return raw ? (JSON.parse(raw) as Run) : null;
    },
    webMcpTool(tool) {
      const commits = tool.steps.some((s) => s.risk === "commit");
      const schema = tool.inputSchema as { properties?: Record<string, unknown> };
      return {
        name: tool.name,
        description: `${tool.description} Runs in the user's open page; the user confirms every send and types any OTP/CAPTCHA. Set ${DRY_RUN_PARAM}=true to fill without sending.`,
        inputSchema: {
          ...tool.inputSchema,
          properties: { ...schema.properties, [DRY_RUN_PARAM]: { type: "boolean", description: "Fill the form but send nothing." } },
        },
        annotations: { readOnlyHint: !commits, destructiveHint: false },
        async execute(args) {
          const r = await runtime.run(tool.name, args ?? {});
          return { content: [{ type: "text", text: JSON.stringify(r) }], isError: r.status === "failed" };
        },
      };
    },
  };
  return runtime;
}
