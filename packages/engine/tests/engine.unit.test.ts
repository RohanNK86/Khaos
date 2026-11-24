import { describe, expect, test } from "vitest";
import type { Need, StepContract, Tool } from "@mcpify/contracts";
import { runTool, type NeedAnswer, type RunHooks } from "../src/index.js";
import { FakeDriver } from "../src/fake-driver.js";

const T = 300; // short timeouts for tests

function tool(steps: StepContract[]): Tool {
  return {
    id: "t1", siteId: "s1", name: "demo_tool", title: "Demo", description: "d", version: 1, status: "approved",
    inputSchema: { type: "object", properties: { name: { type: "string", title: "Name" }, pin: { type: "string", sensitive: true } } },
    outputs: [], startUrl: "http://portal.test/", steps: steps.map((s) => ({ timeoutMs: T, ...s })),
    createdAt: "", updatedAt: "",
  };
}
const fillName: StepContract = {
  id: "enter_name", intent: "Fill name", action: { type: "fill", param: "name" },
  locators: [{ kind: "testid", value: "name" }, { kind: "id", value: "txtName" }, { kind: "label", value: "Name" }],
  pre: [{ kind: "visible", locators: [{ kind: "id", value: "txtName" }] }],
  post: [{ kind: "valueEquals", locators: [{ kind: "id", value: "txtName" }], param: "name" }, { kind: "noErrorNear", locators: [{ kind: "id", value: "txtName" }] }],
  risk: "fill", repair: "auto",
};
const submit: StepContract = {
  id: "submit", intent: "Submit", action: { type: "click" }, locators: [{ kind: "id", value: "btnSubmit" }],
  pre: [], post: [{ kind: "urlMatches", pattern: "/done$" }], risk: "commit", repair: "human",
};
const extract: StepContract = {
  id: "read_ref", intent: "Read reference", action: { type: "extract" }, locators: [], pre: [],
  post: [{ kind: "extract", locators: [{ kind: "id", value: "lblRef" }], as: "ref", pattern: "REF-\\d+" }], risk: "read", repair: "auto",
};

function page() {
  return new FakeDriver({
    currentUrl: "http://portal.test/form",
    elements: [
      { id: "txtName", label: "Name" },
      { id: "txtPin", label: "PIN" },
      { id: "btnSubmit", text: "Submit", onClick: (d) => { d.currentUrl = "http://portal.test/done"; d.elements.push({ id: "lblRef", text: "Your reference: REF-42" }); } },
    ],
  });
}
function hooks(answers: NeedAnswer[] = []): RunHooks & { needs: Need[] } {
  const needs: Need[] = [];
  return { needs, onNeed: async (n) => { needs.push(n); return answers.shift() ?? {}; } };
}
const opts = { dryRun: false, mode: "owner" as const };

describe("runTool", () => {
  test("happy path: fill, confirm, submit, extract", async () => {
    const d = page(); const h = hooks([{ approve: true }]);
    const run = await runTool(tool([fillName, submit, extract]), { name: "Asha" }, d, h, opts);
    expect(run.status).toBe("succeeded");
    expect(run.outputs.ref).toBe("REF-42");
    expect(h.needs[0]).toMatchObject({ kind: "confirmation", stepId: "submit", preview: [{ label: "Name", value: "Asha" }] });
    expect(run.trace.map((t) => t.status)).toEqual(["passed", "passed", "passed"]);
  });

  test("locator fallback records the used locator", async () => {
    const d = page();
    const run = await runTool(tool([fillName]), { name: "Asha" }, d, hooks(), opts);
    expect(run.trace[0]!.usedLocator).toEqual({ kind: "id", value: "txtName" });
  });

  test("ambiguous match is not accepted; falls through to next locator", async () => {
    const d = page();
    d.elements.push({ id: "other", label: "Name" }); // two elements labelled Name
    const step = { ...fillName, locators: [{ kind: "label", value: "Name" } as const], pre: [] };
    const run = await runTool(tool([step]), { name: "A" }, d, hooks(), opts);
    expect(run.status).toBe("failed");
    expect(run.trace[0]!.error).toMatch(/no locator matched/);
  });

  test("precondition failure stops with evidence", async () => {
    const d = page(); d.elements[0]!.visible = false;
    const h = { ...hooks(), saveBlob: async () => "blob-1" };
    const run = await runTool(tool([fillName]), { name: "A" }, d, h, opts);
    expect(run).toMatchObject({ status: "failed", failedStepId: "enter_name" });
    expect(run.trace[0]!.evidenceBlobId).toBe("blob-1");
  });

  test("postcondition failure (validation error next to field)", async () => {
    const d = page(); d.elements[0]!.error = true;
    const run = await runTool(tool([fillName]), { name: "A" }, d, hooks(), opts);
    expect(run.status).toBe("failed");
    expect(run.trace[0]!.error).toMatch(/postcondition failed.*the page says/);
  });

  test("dry run blocks the first commit step", async () => {
    const d = page(); const h = hooks();
    const run = await runTool(tool([fillName, submit, extract]), { name: "A" }, d, h, { ...opts, dryRun: true });
    expect(run.status).toBe("dry_run_complete");
    expect(run.trace.map((t) => t.status)).toEqual(["passed", "blocked_dry_run"]);
    expect(d.actions.some((a) => a.startsWith("click"))).toBe(false);
    expect(h.needs).toHaveLength(0);
  });

  test("rejected confirmation stops without clicking", async () => {
    const d = page();
    const run = await runTool(tool([fillName, submit]), { name: "A" }, d, hooks([{ approve: false }]), opts);
    expect(run.status).toBe("stopped");
    expect(d.actions.some((a) => a.startsWith("click"))).toBe(false);
  });

  test("user input is filled but never stored", async () => {
    const d = page();
    const pin: StepContract = {
      id: "enter_pin", intent: "Enter PIN", action: { type: "userInput", param: "pin", prompt: "PIN?" },
      locators: [{ kind: "id", value: "txtPin" }], pre: [], post: [], risk: "auth", repair: "human", sensitive: true,
    };
    const h = hooks([{ value: "9876" }]);
    const run = await runTool(tool([pin]), {}, d, h, opts);
    expect(run.status).toBe("succeeded");
    expect(h.needs[0]).toMatchObject({ kind: "user_input", param: "pin", sensitive: true });
    expect(d.elements[1]!.value).toBe("9876");
    expect(JSON.stringify(run)).not.toContain("9876");
  });

  test("abort stops the run", async () => {
    const ac = new AbortController(); ac.abort();
    const run = await runTool(tool([fillName]), { name: "A" }, page(), hooks(), { ...opts, signal: ac.signal });
    expect(run.status).toBe("stopped");
  });

  test("commit steps already executed are skipped on resume", async () => {
    const d = page();
    const run = await runTool(tool([fillName, submit]), { name: "A" }, d, hooks([{ approve: true }]), { ...opts, committedStepIds: ["submit"] });
    expect(run.trace[1]!.status).toBe("skipped");
    expect(d.actions.some((a) => a.startsWith("click"))).toBe(false);
  });

  test("missing input fails clearly", async () => {
    const run = await runTool(tool([fillName]), {}, page(), hooks(), opts);
    expect(run.trace[0]!.error).toMatch(/missing input "name"/);
  });
});
