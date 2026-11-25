// E5: Portal 1 in owner mode loads mcpify.js from a stub API; tools are exposed on window.MCPify and WebMCP.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type Browser } from "playwright";
import type { Run, Tool } from "@mcpify/contracts";
import { runTool } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";
import { createScholarshipPortal } from "@mcpify/portals";
import { buildMcpifyJs } from "../build.mjs";
import { applyInputs, golden, LAB, labHooks, labState, portOf } from "./helpers.js";

let portal: Server;
let api: Server;
let base: string;
let browser: Browser;
let tools: Tool[];
let bundleDir: string;
const reports: Run[] = [];
const manifestOrigins: string[] = [];

const body = async (req: IncomingMessage) => {
  let s = "";
  for await (const c of req) s += c;
  return s;
};

/** Stub of the API endpoints mcpify.js uses (01-CONTRACTS §11). */
function stubApi(): Server {
  return createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (url.pathname === "/static/mcpify.js") {
      return res.writeHead(200, { "content-type": "text/javascript" }).end(await readFile(join(bundleDir, "mcpify.js")));
    }
    if (url.pathname === "/sites/manifest") {
      manifestOrigins.push(url.searchParams.get("origin") ?? "");
      const site = { id: "site-scholarship", origin: base, slug: "scholarship", name: "State Scholarship Portal (DEMO)", mode: "owner" };
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ site, tools }));
    }
    if (url.pathname === "/runs/report" && req.method === "POST") {
      reports.push(JSON.parse(await body(req)) as Run);
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "rep-1" }));
    }
    res.writeHead(404).end();
  });
}

beforeAll(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), "mcpify-js-"));
  await buildMcpifyJs({ minify: false, outfile: join(bundleDir, "mcpify.js") });
  api = stubApi().listen(0);
  portal = createScholarshipPortal({ apiUrl: `http://localhost:${portOf(api)}` }).listen(0);
  base = `http://localhost:${portOf(portal)}`;
  tools = [await golden("apply_scholarship", base), await golden("check_application_status", base)];
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
  portal?.close();
  api?.close();
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

test("mcpify.js lists tools, registers them with WebMCP and runs check_application_status across reloads", async () => {
  await fetch(`${base}/__lab/reset`, { method: "POST", headers: LAB });
  // 1. Create an application with the server-side engine (Playwright driver).
  const ctx = await browser.newContext();
  const created = await runTool(tools[0]!, applyInputs, createPlaywrightDriver(await ctx.newPage()), labHooks(ctx, base), { dryRun: false, mode: "owner" });
  expect(created.status).toBe("succeeded");
  const appId = created.outputs.application_id!;
  await ctx.close();

  // 2. Owner mode page: mcpify.js comes from the stub API's /static/mcpify.js.
  const page = await browser.newPage();
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto(`${base}/status?owner=1`);
  await page.waitForFunction(() => window.MCPify !== undefined, undefined, { timeout: 15_000 });
  expect(manifestOrigins).toContain(base);
  const info = await page.evaluate(async () => {
    const mc = (document as unknown as { modelContext?: { getTools(): Promise<{ name: string }[]> } }).modelContext;
    return {
      tools: window.MCPify!.tools.map((t) => t.name),
      webmcp: window.MCPify!.webmcp,
      modelContextTools: mc ? (await mc.getTools()).map((t) => t.name) : [],
    };
  });
  expect(info.tools).toEqual(["apply_scholarship", "check_application_status"]);
  expect(info.webmcp.provider).toMatch(/^(native|mcp-b)$/);
  expect(info.webmcp.registered).toEqual(["apply_scholarship", "check_application_status"]);
  expect(info.modelContextTools).toEqual(expect.arrayContaining(["apply_scholarship", "check_application_status"]));

  // 3. Run in-page. The status page reloads twice (navigate + form POST); the run resumes from sessionStorage.
  await page.evaluate(([id, dob]) => { void window.MCPify!.run("check_application_status", { application_id: id, date_of_birth: dob }); }, [appId, applyInputs.date_of_birth] as const);
  const raw = await page.waitForFunction(() => sessionStorage.getItem("mcpify:last-run"), undefined, { timeout: 30_000 });
  const run = JSON.parse((await raw.jsonValue()) as string) as Run;
  expect(run.trace.find((t) => t.status === "failed")?.error, logs.join("\n")).toBeUndefined();
  expect(run.status).toBe("succeeded");
  expect(run.outputs.application_status).toBe("Under verification");
  expect(run.trace.map((t) => t.stepId)).toEqual(tools[1]!.steps.map((s) => s.id));
  await expect.poll(() => reports.map((r) => r.id)).toContain(run.id);
  expect((await labState(base)).applications).toHaveLength(1);
  await page.close();
}, 90_000);
