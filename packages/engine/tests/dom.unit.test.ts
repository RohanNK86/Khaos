import { afterEach, describe, expect, test } from "vitest";
import { Window } from "happy-dom";
import type { Need, StepContract, Tool } from "@mcpify/contracts";
import { runTool, type RunHooks } from "../src/index.js";
import {
  createDomDriver, loadRunState, persistRunState, resumeToolInPage, runToolInPage,
  type PersistedRunState, type RunStateStorage,
} from "../src/dom.js";

const T = 300;
const windows: Window[] = [];
afterEach(async () => { for (const w of windows.splice(0)) await w.happyDOM.close(); });

function page(html: string, url = "http://portal.test/apply/1"): Document {
  const w = new Window({ url });
  windows.push(w);
  w.document.body.innerHTML = html;
  return w.document as unknown as Document;
}

const PAGE1 = `
<form><table>
<tr><td>Applicant Name *</td><td><input id="txtName" name="txtName"/></td></tr>
<tr><td>Secret PIN</td><td><input id="txtPin" type="password"/></td></tr>
<tr><td><label for="ddlCourse">Course</label></td><td><select id="ddlCourse"><option value="0">--Select--</option><option value="BSC">B.Sc</option><option value="BA">B.A</option></select></td></tr>
<tr><td>I agree</td><td><input type="checkbox" id="chkAgree"/></td></tr>
<tr><td>Certificate</td><td><input type="file" id="fuCert"/></td></tr>
</table>
<button type="button" id="btnNext">Next</button>
<span id="lblRef">Reference: REF-77</span>
</form>`;

const id = (value: string) => [{ kind: "id" as const, value }];
const step = (s: Partial<StepContract> & Pick<StepContract, "id" | "action">): StepContract => ({
  intent: s.id, locators: [], pre: [], post: [], risk: "fill", repair: "auto", timeoutMs: T, ...s,
});
function tool(steps: StepContract[]): Tool {
  return {
    id: "t-dom", siteId: "s1", name: "dom_tool", title: "DOM", description: "d", version: 1, status: "approved",
    inputSchema: { type: "object", properties: { name: { type: "string", title: "Name" }, pin: { type: "string", title: "PIN", sensitive: true } } },
    outputs: [], startUrl: "http://portal.test/apply/1", steps, createdAt: "", updatedAt: "",
  };
}
const noNeeds: RunHooks = { onNeed: async () => ({}) };

function memStorage(seed: Record<string, string> = {}): RunStateStorage & { data: Record<string, string>; writes: string[] } {
  const data = { ...seed };
  const writes: string[] = [];
  return {
    data, writes,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; writes.push(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

describe("createDomDriver", () => {
  test("resolves with the shared in-page rules (table-cell label, label[for], text)", async () => {
    const d = createDomDriver(page(PAGE1));
    expect((await d.resolve([{ kind: "testid", value: "nope" }, { kind: "label", value: "Applicant Name" }]))?.used).toEqual({ kind: "label", value: "Applicant Name" });
    expect(await d.resolve([{ kind: "label", value: "Course" }])).not.toBeNull();
    expect(await d.resolve([{ kind: "text", value: "Next" }])).not.toBeNull();
    expect(await d.resolve([{ kind: "css", value: "input" }])).toBeNull(); // ambiguous → no match
  });

  test("fill uses the native setter and fires input + change", async () => {
    const doc = page(PAGE1);
    const events: string[] = [];
    const input = doc.getElementById("txtName") as HTMLInputElement;
    for (const t of ["input", "change"]) input.addEventListener(t, () => events.push(`${t}:${input.value}`));
    const d = createDomDriver(doc);
    const r = (await d.resolve(id("txtName")))!;
    await d.fill(r.handle, "Asha Demo");
    expect(await d.value(r.handle)).toBe("Asha Demo");
    expect(events).toEqual(["input:Asha Demo", "change:Asha Demo"]);
  });

  test("select by label or value, check, upload via DataTransfer", async () => {
    const doc = page(PAGE1);
    const d = createDomDriver(doc);
    const sel = (await d.resolve(id("ddlCourse")))!.handle;
    await d.select(sel, "b.sc");
    expect(await d.value(sel)).toBe("B.Sc");
    await d.select(sel, "BA");
    expect(await d.value(sel)).toBe("B.A");
    await expect(d.select(sel, "PhD")).rejects.toThrow(/not found/);
    const box = (await d.resolve(id("chkAgree")))!.handle;
    await d.check(box, true);
    expect(await d.value(box)).toBe("true");
    const file = (await d.resolve(id("fuCert")))!.handle;
    await d.upload(file, { name: "cert.pdf", mime: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) });
    expect((doc.getElementById("fuCert") as HTMLInputElement).files?.[0]?.name).toBe("cert.pdf");
  });

  test("runTool end to end on a static page with the DomDriver", async () => {
    const t = tool([
      step({ id: "enter_name", action: { type: "fill", param: "name" }, locators: [{ kind: "label", value: "Applicant Name" }], post: [{ kind: "valueEquals", locators: id("txtName"), param: "name" }] }),
      step({ id: "read_ref", action: { type: "extract" }, risk: "read", post: [{ kind: "extract", locators: id("lblRef"), as: "ref", pattern: "REF-\\d+" }] }),
    ]);
    const run = await runTool(t, { name: "Asha" }, createDomDriver(page(PAGE1)), noNeeds, { dryRun: false, mode: "user" });
    expect(run.status).toBe("succeeded");
    expect(run.outputs.ref).toBe("REF-77");
  });

  test("goto to the current URL is a no-op; other URLs call onBeforeNavigation first", async () => {
    const doc = page(PAGE1);
    const calls: string[] = [];
    const d = createDomDriver(doc, { onBeforeNavigation: () => { calls.push("before"); } });
    await d.goto("http://portal.test/apply/1#top");
    expect(calls).toEqual([]);
    const r = (await d.resolve(id("btnNext")))!;
    await d.click(r.handle);
    expect(calls).toEqual(["before"]);
  });
});

describe("run state persistence", () => {
  const state = (over: Partial<PersistedRunState> = {}): PersistedRunState => ({
    v: 1, runId: "r1", toolId: "t-dom", toolVersion: 1, stepIndex: 1, inputs: { name: "A" }, sensitiveKeys: [],
    committedStepIds: [], dryRun: true, mode: "user", savedAt: Date.now(),
    run: { id: "r1", toolId: "t-dom", toolVersion: 1, mode: "user", dryRun: true, status: "running", inputsRedacted: {}, outputs: {}, trace: [], startedAt: "" },
    ...over,
  });

  test("round trip, and stale or malformed state is ignored", async () => {
    const s = memStorage();
    await persistRunState(state(), s);
    expect((await loadRunState(s))?.runId).toBe("r1");
    await persistRunState(state({ savedAt: Date.now() - 60 * 60 * 1000 }), s);
    expect(await loadRunState(s)).toBeNull();
    await s.setItem("mcpify:run", "{not json");
    expect(await loadRunState(s)).toBeNull();
  });
});

describe("runToolInPage / resumeToolInPage across a reload", () => {
  const PAGE2 = `<h1>Page 2</h1><table><tr><td>City</td><td><input id="txtCity"/></td></tr></table>`;
  const t = tool([
    step({ id: "enter_name", action: { type: "fill", param: "name" }, locators: id("txtName"), post: [{ kind: "valueEquals", locators: id("txtName"), param: "name" }] }),
    step({ id: "enter_pin", action: { type: "fill", param: "pin" }, locators: id("txtPin"), sensitive: true }),
    step({ id: "go_next", action: { type: "click" }, locators: id("btnNext"), post: [{ kind: "textPresent", text: "Page 2" }] }),
    step({ id: "enter_city", action: { type: "fill", param: "pin" }, locators: id("txtCity"), sensitive: true }),
  ]);

  test("saves state before the navigating click, without sensitive values, and resumes on the next page", async () => {
    const first = memStorage();
    const run1 = await runToolInPage(t, { name: "Asha", pin: "4321" }, page(PAGE1), noNeeds, { dryRun: false, mode: "user", storage: first });
    // In a real browser the page unloads at the click; here the old page stays, so post fails.
    expect(run1.status).toBe("failed");
    const saved = first.writes.at(-1)!;
    expect(saved).not.toContain("4321");
    const parsed = JSON.parse(saved) as PersistedRunState;
    expect(parsed).toMatchObject({ stepIndex: 2, pendingStepId: "go_next", sensitiveKeys: ["pin"], inputs: { name: "Asha" } });

    const second = memStorage({ "mcpify:run": saved });
    const loaded = (await loadRunState(second))!;
    const needs: Need[] = [];
    const hooks: RunHooks = { onNeed: async (n) => { needs.push(n); return { value: "4321" }; } };
    const run2 = await resumeToolInPage(t, loaded, page(PAGE2, "http://portal.test/apply/2"), hooks, { storage: second });
    expect(run2.status).toBe("succeeded");
    expect(run2.id).toBe(run1.id);
    expect(run2.trace.map((x) => x.stepId)).toEqual(["enter_name", "enter_pin", "go_next", "enter_city"]);
    expect(needs[0]).toMatchObject({ kind: "user_input", param: "pin", sensitive: true });
    expect(run2.inputsRedacted).toEqual({ name: "Asha", pin: "•••" });
    expect(second.data["mcpify:run"]).toBeUndefined();
  });

  test("a commit step that navigated is never executed again on resume", async () => {
    const commitTool = tool([
      step({ id: "submit", action: { type: "click" }, locators: id("btnNext"), risk: "commit", repair: "human", post: [{ kind: "textPresent", text: "Page 2" }] }),
    ]);
    const first = memStorage();
    await runToolInPage(commitTool, {}, page(PAGE1), { onNeed: async () => ({ approve: true }) }, { dryRun: false, mode: "user", storage: first });
    const saved = JSON.parse(first.writes.at(-1)!) as PersistedRunState;
    expect(saved.committedStepIds).toEqual(["submit"]);
    const second = memStorage({ "mcpify:run": JSON.stringify(saved) });
    const asked: Need[] = [];
    const run = await resumeToolInPage(commitTool, saved, page(PAGE2), { onNeed: async (n) => { asked.push(n); return {}; } }, { storage: second });
    expect(run.status).toBe("succeeded");
    expect(asked).toEqual([]);
    expect(run.trace.map((x) => `${x.stepId}:${x.status}`)).toEqual(["submit:passed"]);
  });

  test("resume fails cleanly when the page after the reload is not the expected one", async () => {
    const first = memStorage();
    await runToolInPage(t, { name: "Asha", pin: "1" }, page(PAGE1), noNeeds, { dryRun: false, mode: "user", storage: first });
    const saved = JSON.parse(first.writes.at(-1)!) as PersistedRunState;
    const run = await resumeToolInPage(t, saved, page("<p>Error 500</p>"), noNeeds, { storage: memStorage() });
    expect(run).toMatchObject({ status: "failed", failedStepId: "go_next" });
  });
});
