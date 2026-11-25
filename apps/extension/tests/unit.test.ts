import { describe, expect, test } from "vitest";
import type { Run, Tool } from "@mcpify/contracts";
import { FakeDriver } from "@mcpify/engine/fake";
import { chatTurn, ChatUnavailable } from "../src/chat.js";
import { executeRun } from "../src/controller.js";
import { coerceInputs, formFields } from "../src/form.js";
import { guardRule, type Guard } from "../src/guard.js";
import { effectiveSafety, originOf, policyFor } from "../src/policy.js";
import { fromBase64, isContentMessage, toBase64, type ContentMessage, type Reply } from "../src/protocol.js";
import { createRemoteDriver, type TabTransport } from "../src/remote-driver.js";
import { bundledTools, loadTools, parseManifest } from "../src/tools-source.js";

const apply = () => bundledTools("http://localhost:5101").tools.find((t) => t.name === "apply_scholarship")!;

describe("dry-run policy", () => {
  test("demo portals may run for real; everything else is forced dry-run with the guard", () => {
    expect(policyFor("http://localhost:5101")).toEqual({ isDemo: true, dryRunDefault: false, dryRunForced: false, guardForced: false });
    expect(policyFor("https://scholarships.gov.example")).toEqual({ isDemo: false, dryRunDefault: true, dryRunForced: true, guardForced: true });
    expect(policyFor("http://localhost:5199").dryRunForced).toBe(true);
    expect(policyFor(null).dryRunForced).toBe(true);
  });
  test("forced settings win over the user's choice", () => {
    expect(effectiveSafety(policyFor("https://x.example"), { dryRun: false, strictGuard: false })).toEqual({ dryRun: true, strictGuard: true });
    expect(effectiveSafety(policyFor("http://localhost:5102"), { dryRun: false, strictGuard: true })).toEqual({ dryRun: false, strictGuard: false });
    expect(effectiveSafety(policyFor("http://localhost:5102"), { dryRun: true, strictGuard: true })).toEqual({ dryRun: true, strictGuard: true });
  });
  test("originOf only accepts http(s)", () => {
    expect(originOf("http://localhost:5101/apply/1?x=1")).toBe("http://localhost:5101");
    expect(originOf("chrome://extensions")).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

test("guard rule blocks every sending method from the tab, including form navigations", () => {
  const r = guardRule(42);
  expect(r).toMatchObject({ id: 43, action: { type: "block" }, condition: { tabIds: [42], requestMethods: ["post", "put", "patch", "delete"] } });
  expect(r.condition.resourceTypes).toContain("main_frame");
  expect(r.condition.resourceTypes).toContain("xmlhttprequest");
});

describe("form from inputSchema", () => {
  test("field kinds, required flags and the upload picker", () => {
    const f = Object.fromEntries(formFields(apply()).map((x) => [x.key, x]));
    expect(f.gender).toMatchObject({ kind: "enum", options: ["Male", "Female", "Other"], required: true, title: "Gender" });
    expect(f.annual_income!.kind).toBe("integer");
    expect(f.declaration!.kind).toBe("boolean");
    expect(f.date_of_birth!.kind).toBe("date");
    expect(f.income_certificate).toMatchObject({ kind: "file", required: false, defaultValue: "sample-income-certificate.pdf" });
  });
  test("coerces types and reports errors", () => {
    const fields = formFields(apply());
    const ok = coerceInputs(fields, {
      applicant_name: " Asha ", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210", email: "a@example.com",
      course: "B.Sc", year_of_study: "2nd Year", institution_name: "College", annual_income: "180000", category: "OBC", declaration: true,
    });
    expect(ok.errors).toEqual({});
    expect(ok.inputs).toMatchObject({ applicant_name: "Asha", annual_income: 180000, declaration: true });
    const bad = coerceInputs(fields, { mobile: "12345", annual_income: "lots", gender: "Robot" });
    expect(bad.errors).toMatchObject({ mobile: "Wrong format.", annual_income: "Enter a number.", declaration: "Please tick this box.", applicant_name: "Required." });
    expect(bad.errors.gender).toMatch(/Choose one of/);
  });
});

describe("tool source", () => {
  test("bundled golden tools only for their own origin", () => {
    expect(bundledTools("http://localhost:5101").tools.map((t) => t.name)).toEqual(["apply_scholarship", "check_application_status"]);
    expect(bundledTools("https://example.org")).toEqual({ source: "none", site: null, tools: [] });
  });
  test("API first, bundled when the API is down", async () => {
    const t = apply();
    const site = { id: "s", origin: "http://localhost:5101", slug: "scholarship", name: "Demo", mode: "owner" };
    const fromApi = await loadTools("http://api", "http://localhost:5101", async () => new Response(JSON.stringify({ site, tools: [t] })));
    expect(fromApi.source).toBe("api");
    const down = await loadTools("http://api", "http://localhost:5101", async () => { throw new Error("ECONNREFUSED"); });
    expect(down.source).toBe("bundled");
    expect(parseManifest({ site, tools: [{ ...t, status: "draft" }] })?.tools).toEqual([]);
  });
});

describe("protocol", () => {
  test("base64 round trip and message guard", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(isContentMessage({ kind: "mcpify:call", method: "fill", args: [], banner: false })).toBe(true);
    expect(isContentMessage({ kind: "mcpify:call", method: "evalArbitrary", args: [] })).toBe(false);
    expect(isContentMessage("hi")).toBe(false);
  });
});

/** Transport over a FakeDriver that can simulate a page that has no content script yet, or unloads on click. */
function fakeTransport(d: FakeDriver, opts: { injected?: boolean; clickUnloads?: boolean } = {}) {
  let injected = opts.injected ?? true;
  const log: string[] = [];
  const t: TabTransport = {
    async send(m: ContentMessage): Promise<Reply> {
      if (!injected) return { ok: false, error: "Could not establish connection. Receiving end does not exist." };
      if (m.kind !== "mcpify:call") return { ok: true };
      log.push(m.method);
      const fn = (d as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[m.method]!;
      const value = await fn.apply(d, m.args);
      if (m.method === "click" && opts.clickUnloads) { injected = false; return { ok: false, error: "The message port closed before a response was received." }; }
      return { ok: true, value };
    },
    async inject() { log.push("inject"); injected = true; },
    async navigate(url) { d.currentUrl = url; injected = false; },
    async status() { return "complete"; },
  };
  return { t, log };
}

describe("remote driver", () => {
  test("injects the content script when nothing answers, then retries", async () => {
    const d = new FakeDriver({ currentUrl: "http://p/x", elements: [{ id: "a", text: "A" }] });
    const { t, log } = fakeTransport(d, { injected: false });
    const rd = createRemoteDriver(t, { banner: true, settleTimeoutMs: 100 });
    expect(await rd.url()).toBe("http://p/x");
    expect(log).toEqual(["inject", "url"]);
  });
  test("a click whose page unloads counts as done and is not repeated", async () => {
    let clicks = 0;
    const d = new FakeDriver({ elements: [{ id: "go", text: "Go", onClick: () => { clicks++; } }] });
    const { t } = fakeTransport(d, { clickUnloads: true });
    const rd = createRemoteDriver(t, { banner: false, settleTimeoutMs: 100 });
    const r = (await rd.resolve([{ kind: "id", value: "go" }]))!;
    await rd.click(r.handle);
    expect(clicks).toBe(1);
  });
  test("driver errors from the page surface as errors", async () => {
    const t: TabTransport = { send: async () => ({ ok: false, error: 'option "PhD" not found' }), inject: async () => {}, navigate: async () => {}, status: async () => "complete" };
    await expect(createRemoteDriver(t, { banner: false }).select("r1", "PhD")).rejects.toThrow(/PhD/);
  });
});

function fakeGuard(): Guard & { calls: string[] } {
  const calls: string[] = [];
  return { calls, log: [], arm: async () => { calls.push("arm"); }, disarm: async () => { calls.push("disarm"); }, count: async () => 2 };
}
const tinyTool: Tool = {
  id: "t", siteId: "s", name: "tiny", title: "Tiny", description: "d", version: 1, status: "approved",
  inputSchema: { type: "object", properties: { name: { type: "string" } } }, outputs: [], startUrl: "http://p/",
  steps: [
    { id: "fill_name", intent: "Fill", action: { type: "fill", param: "name" }, locators: [{ kind: "id", value: "n" }], pre: [], post: [], risk: "fill", repair: "auto", timeoutMs: 200 },
    { id: "send", intent: "Send", action: { type: "click" }, locators: [{ kind: "id", value: "s" }], pre: [], post: [], risk: "commit", repair: "human", timeoutMs: 200 },
  ],
  createdAt: "", updatedAt: "",
};

describe("run controller", () => {
  test("dry run with the guard: arms, banners, blocks the commit, disarms, reports", async () => {
    const guard = fakeGuard();
    const banners: boolean[] = [];
    const reported: Run[] = [];
    const d = new FakeDriver({ elements: [{ id: "n" }, { id: "s", text: "Send" }] });
    const r = await executeRun(tinyTool, { name: "A" }, { dryRun: true, strictGuard: true }, {
      driver: d, guard, banner: async (on) => { banners.push(on); }, report: async (run) => { reported.push(run); return "rep-1"; },
    }, { onNeed: async () => ({ approve: true }) });
    expect(r.run.status).toBe("dry_run_complete");
    expect(r).toMatchObject({ blocked: 2, reportId: "rep-1" });
    expect(guard.calls).toEqual(["arm", "disarm"]);
    expect(banners).toEqual([true, false]);
    expect(reported[0]!.mode).toBe("user");
  });
  test("a real run on a demo portal leaves the guard off", async () => {
    const guard = fakeGuard();
    const d = new FakeDriver({ elements: [{ id: "n" }, { id: "s", text: "Send" }] });
    const r = await executeRun(tinyTool, { name: "A" }, { dryRun: false, strictGuard: false }, {
      driver: d, guard, banner: async () => {}, report: async () => null,
    }, { onNeed: async () => ({ approve: true }) });
    expect(r.run.status).toBe("succeeded");
    expect(guard.calls).toEqual([]);
    expect(r.blocked).toBe(0);
  });
});

describe("chat loop", () => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  test("runs tool_use blocks locally and sends tool_results back", async () => {
    const bodies: { messages: unknown[]; tools: { name: string }[] }[] = [];
    const answers = [
      reply({ stop_reason: "tool_use", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "tu1", name: "scholarship__tiny", input: { name: "A" } }] }),
      reply({ stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] }),
    ];
    const said: string[] = [];
    const ran: unknown[] = [];
    const history = await chatTurn([], "do it", {
      apiBase: "http://api", tools: [tinyTool], onAssistantText: (t) => said.push(t),
      execute: async (tool, input) => { ran.push([tool.name, input]); return { text: '{"status":"succeeded"}', isError: false }; },
      fetch: async (_u, init) => { bodies.push(JSON.parse(String(init?.body))); return answers.shift()!; },
    });
    expect(ran).toEqual([["tiny", { name: "A" }]]);
    expect(said).toEqual(["Checking.", "Done."]);
    expect(bodies[0]!.tools.map((t) => t.name)).toEqual(["tiny"]);
    expect(history.at(-2)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: '{"status":"succeeded"}' }] });
  });
  test("503 from the API disables chat", async () => {
    await expect(chatTurn([], "hi", {
      apiBase: "http://api", tools: [], onAssistantText: () => {}, execute: async () => ({ text: "", isError: false }),
      fetch: async () => reply({ error: "no model" }, 503),
    })).rejects.toBeInstanceOf(ChatUnavailable);
  });
});
