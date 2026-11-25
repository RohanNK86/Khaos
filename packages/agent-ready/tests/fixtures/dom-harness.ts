// Injected into Portal 1 by dom-resume.e2e.test.ts: runs a tool with the DomDriver and resumes it after each reload.
import type { Run, Tool } from "@mcpify/contracts";
import { loadRunState, resumeToolInPage, runToolInPage } from "@mcpify/engine/dom";

const TOOL_KEY = "harness:tool";
const RESULT_KEY = "harness:result";
const hooks = { onNeed: async () => ({}) };
const save = (run: Run) => sessionStorage.setItem(RESULT_KEY, JSON.stringify(run));

(window as unknown as { __harness: unknown }).__harness = {
  start(tool: Tool, inputs: Record<string, unknown>) {
    sessionStorage.setItem(TOOL_KEY, JSON.stringify(tool));
    sessionStorage.removeItem(RESULT_KEY);
    void runToolInPage(tool, inputs, document, hooks, { dryRun: true, mode: "user" }).then(save);
  },
};

async function resume() {
  const state = await loadRunState();
  const tool = sessionStorage.getItem(TOOL_KEY);
  if (state && tool) save(await resumeToolInPage(JSON.parse(tool) as Tool, state, document, hooks, {}));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void resume());
else void resume();
