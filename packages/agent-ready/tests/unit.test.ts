import { describe, expect, test } from "vitest";
import type { Run } from "@mcpify/contracts";
import { parseManifest, reportRun } from "../src/api.js";
import { toCallResult } from "../src/result.js";
import { createWebMcpAdapter, type ModelContextLike, type WebMcpTool } from "../src/webmcp-adapter.js";
import { golden } from "./helpers.js";

const site = { id: "s", origin: "http://localhost:5101", slug: "scholarship", name: "Demo", mode: "owner" };
const tool = (name: string): WebMcpTool => ({ name, description: "d", inputSchema: { type: "object" }, execute: async () => ({ content: [] }) });

function fakeContext() {
  const tools: { name: string; signal?: AbortSignal }[] = [];
  const ctx: ModelContextLike = { registerTool: (t, o) => { tools.push({ name: t.name, signal: o?.signal }); } };
  return { ctx, tools };
}
const env = (doc: object, nav: object = {}, loadPolyfill = async () => {}) =>
  ({ doc: doc as Document, nav: nav as Navigator, loadPolyfill });

describe("WebMCP adapter", () => {
  test("uses document.modelContext when the browser has it", async () => {
    const { ctx, tools } = fakeContext();
    const a = await createWebMcpAdapter(env({ modelContext: ctx }));
    await a.register(tool("apply_scholarship"));
    expect(a.provider).toBe("native");
    expect(a.registered).toEqual(["apply_scholarship"]);
    a.unregisterAll();
    expect(tools[0]!.signal?.aborted).toBe(true);
  });

  test("accepts the older navigator.modelContext", async () => {
    const { ctx } = fakeContext();
    expect((await createWebMcpAdapter(env({}, { modelContext: ctx }))).provider).toBe("native");
  });

  test("loads the MCP-B polyfill when there is no context", async () => {
    const doc: { modelContext?: ModelContextLike } = {};
    const { ctx, tools } = fakeContext();
    const a = await createWebMcpAdapter(env(doc, {}, async () => { doc.modelContext = ctx; }));
    await a.register(tool("check_application_status"));
    expect(a.provider).toBe("mcp-b");
    expect(tools.map((t) => t.name)).toEqual(["check_application_status"]);
  });

  test("degrades to a no-op when nothing is available", async () => {
    const a = await createWebMcpAdapter(env({}, {}, async () => { throw new Error("blocked"); }));
    await a.register(tool("x"));
    expect(a.provider).toBe("none");
    expect(a.registered).toEqual([]);
  });
});

describe("manifest + results", () => {
  test("parseManifest keeps only valid approved tools", async () => {
    const t = await golden("check_application_status", "http://localhost:5101");
    const m = parseManifest({ site, tools: [t, { ...t, status: "draft" }, { bogus: true }] });
    expect(m?.tools.map((x) => x.name)).toEqual(["check_application_status"]);
    expect(parseManifest({ tools: [] })).toBeNull();
  });

  test("toCallResult mirrors the MCP result shape", () => {
    const run: Run = {
      id: "r1", toolId: "t", toolVersion: 1, mode: "owner", dryRun: false, status: "failed", inputsRedacted: {}, outputs: {},
      trace: [{ stepId: "enter_x", status: "failed", preResults: [], postResults: [], startedAt: "", durationMs: 1, error: "field not found" }],
      startedAt: "",
    };
    expect(toCallResult(run)).toMatchObject({ run_id: "r1", status: "failed", error: "enter_x: field not found" });
  });

  test("reportRun returns null when the API is down", async () => {
    const run: Run = { id: "r", toolId: "t", toolVersion: 1, mode: "owner", dryRun: true, status: "dry_run_complete", inputsRedacted: {}, outputs: {}, trace: [], startedAt: "" };
    expect(await reportRun("http://127.0.0.1:9", run, async () => { throw new Error("ECONNREFUSED"); })).toBeNull();
    expect(await reportRun("http://api", run, async () => new Response(JSON.stringify({ id: "x" })))).toBe("x");
  });
});
