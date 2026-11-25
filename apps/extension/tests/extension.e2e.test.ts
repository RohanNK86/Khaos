// E4: the unpacked extension in Chromium. The side panel page is opened as a tab with ?tabId=<portal tab>
// (Playwright cannot click the toolbar icon to open the real side panel); everything else is the real path:
// panel → engine → chrome.tabs messaging → content script DomDriver → portal, plus DNR session rules.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import { ToolSchema, type Run, type Tool } from "@mcpify/contracts";
import { createScholarshipPortal } from "@mcpify/portals";
import { buildExtension } from "../build.mjs";

const root = new URL("../../../", import.meta.url);
const LAB = { "x-lab-token": "changeme" };
const port = (s: Server) => (s.address() as AddressInfo).port;

let portal: Server;
let api: Server;
let demoBase: string; // allowlisted in the test build
let otherBase: string; // same portal, but not allowlisted (127.0.0.1)
let ctx: BrowserContext;
let sw: Worker;
let extId: string;
let dir: string;
const reports: Run[] = [];

const inputs: Record<string, string | number | boolean> = {
  applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210",
  email: "asha.demo@example.com", course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College",
  annual_income: 180000, category: "OBC", declaration: true,
};

async function goldenFor(origin: string): Promise<Tool[]> {
  return Promise.all(["apply_scholarship", "check_application_status"].map(async (n) => {
    const raw = await readFile(new URL(`fixtures/tools/scholarship.${n}.v1.json`, root), "utf8");
    return ToolSchema.parse(JSON.parse(raw.replaceAll("http://localhost:5101", origin))) as Tool;
  }));
}

async function readBody(req: IncomingMessage) {
  let s = "";
  for await (const c of req) s += c;
  return s;
}

function stubApi(): Server {
  return createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    const url = new URL(req.url ?? "/", "http://stub");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (url.pathname === "/sites/manifest") {
      const origin = url.searchParams.get("origin") ?? "";
      const site = { id: "site-scholarship", origin, slug: "scholarship", name: "State Scholarship Portal (DEMO)", mode: "owner" };
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ site, tools: await goldenFor(origin) }));
    }
    if (url.pathname === "/runs/report" && req.method === "POST") {
      reports.push(JSON.parse(await readBody(req)) as Run);
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `rep-${reports.length}` }));
    }
    if (url.pathname === "/agent/step") return res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "no model" }));
    res.writeHead(404).end();
  });
}

beforeAll(async () => {
  api = stubApi().listen(0);
  portal = createScholarshipPortal().listen(0);
  demoBase = `http://localhost:${port(portal)}`;
  otherBase = `http://127.0.0.1:${port(portal)}`;
  dir = await mkdtemp(join(tmpdir(), "mcpify-ext-"));
  const ext = await buildExtension({ outdir: join(dir, "ext"), extraDemoOrigins: [demoBase], minify: false });
  ctx = await chromium.launchPersistentContext(join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  extId = new URL(sw.url()).host;
  await sw.evaluate((base) => chrome.storage.local.set({ apiBase: base }), `http://localhost:${port(api)}`);
}, 60_000);

afterAll(async () => {
  await ctx?.close();
  portal?.close();
  api?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const reset = () => fetch(`${demoBase}/__lab/reset`, { method: "POST", headers: LAB });
const applications = async () => ((await (await fetch(`${demoBase}/__lab/state`, { headers: LAB })).json()) as { applications: unknown[] }).applications;
const lab = async (what: "otp" | "captcha") =>
  ((await (await fetch(`${demoBase}/__lab/${what}?session=latest`, { headers: LAB })).json()) as Record<string, string>)[what]!;

/** Open the portal in a tab and the panel (bound to that tab) in another. */
async function openPanel(url: string): Promise<{ site: Page; panel: Page }> {
  const site = await ctx.newPage();
  await site.goto(url);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, site.url());
  expect(tabId).toBeTypeOf("number");
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
  await expect.poll(() => panel.getByTestId("source").textContent()).toBe("from API");
  return { site, panel };
}

async function fillForm(panel: Page) {
  await panel.getByTestId("tool-apply_scholarship").click();
  for (const [k, v] of Object.entries(inputs)) {
    const field = panel.locator(`[data-field="${k}"]`);
    if (typeof v === "boolean") await field.check();
    else if ((await field.evaluate((e) => e.tagName)) === "SELECT") await field.selectOption(String(v));
    else await field.fill(String(v));
  }
}

const finalStatus = async (panel: Page) => {
  await panel.waitForFunction(() => {
    const s = document.querySelector("[data-testid=run-status]")?.getAttribute("data-status");
    return s && s !== "running";
  }, undefined, { timeout: 60_000 });
  return panel.getByTestId("run-status").getAttribute("data-status");
};
const stepStatus = (panel: Page, id: string) => panel.locator(`li[data-step="${id}"]`).getAttribute("data-status");

test("service worker loads with the expected narrow permissions", async () => {
  const m = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(m.manifest_version).toBe(3);
  expect(m.permissions).toEqual(expect.arrayContaining(["sidePanel", "declarativeNetRequest", "scripting", "activeTab", "storage"]));
  expect(m.permissions).not.toContain("tabs");
  expect(m.host_permissions).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
});

test("non-demo origin: dry run and network guard are forced; the page-1 POST is blocked; nothing is created", async () => {
  await reset();
  const { site, panel } = await openPanel(`${otherBase}/apply/1`);
  await expect.poll(() => panel.getByTestId("dry-run").isChecked()).toBe(true);
  expect(await panel.getByTestId("dry-run").isDisabled()).toBe(true);
  expect(await panel.getByTestId("strict-guard").isChecked()).toBe(true);
  expect(await panel.getByTestId("strict-guard").isDisabled()).toBe(true);
  await fillForm(panel);
  const banner = site.locator("#mcpify-dry-run-banner");
  await panel.getByTestId("run").click();
  await expect.poll(() => banner.count(), { timeout: 15_000 }).toBe(1);
  expect(await finalStatus(panel)).toBe("failed");
  expect(await stepStatus(panel, "enter_email")).toBe("passed");
  expect(await stepStatus(panel, "continue_to_academic_details")).toBe("failed");
  expect(Number(await panel.getByTestId("blocked-count").textContent())).toBeGreaterThanOrEqual(1);
  expect(await panel.getByTestId("run-view").textContent()).toMatch(/POST http:\/\/127\.0\.0\.1:\d+\/apply\/1/);
  expect(await applications()).toHaveLength(0);
  await expect.poll(() => reports.at(-1)?.dryRun).toBe(true);
  expect(await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).toEqual([]);
  await site.close();
  await panel.close();
}, 90_000);

test("demo origin, dry run on: fills pages 1-2 across reloads and stops at Send OTP", async () => {
  await reset();
  const { site, panel } = await openPanel(`${demoBase}/apply/1`);
  expect(await panel.getByTestId("dry-run").isChecked()).toBe(false); // default OFF on demo portals
  await panel.getByTestId("dry-run").check();
  await panel.getByTestId("strict-guard").uncheck();
  await fillForm(panel);
  await panel.getByTestId("run").click();
  expect(await finalStatus(panel)).toBe("dry_run_complete");
  expect(await stepStatus(panel, "continue_to_documents")).toBe("passed");
  expect(await stepStatus(panel, "send_otp")).toBe("blocked_dry_run");
  expect(site.url()).toMatch(/\/apply\/3$/);
  expect(await applications()).toHaveLength(0);
  await site.close();
  await panel.close();
}, 90_000);

test("demo origin, dry run off: full run with confirmations and the OTP/CAPTCHA typed in the panel", async () => {
  await reset();
  const { site, panel } = await openPanel(`${demoBase}/apply/1`);
  await fillForm(panel);
  await panel.getByTestId("run").click();
  const need = panel.getByTestId("need");
  await need.getByTestId("approve").click(); // Send OTP
  await panel.getByTestId("need-input").waitFor(); // the OTP was sent and verified on the page
  await panel.getByTestId("need-input").fill(await lab("otp"));
  await panel.getByTestId("need-submit").click();
  await expect.poll(() => need.textContent()).toMatch(/CAPTCHA/);
  await panel.getByTestId("need-input").fill(await lab("captcha"));
  await panel.getByTestId("need-submit").click();
  await need.getByTestId("approve").click(); // Submit
  expect(await finalStatus(panel)).toBe("succeeded");
  expect(await panel.locator('[data-output="application_id"]').textContent()).toMatch(/^SSP-2026-\d{6}$/);
  expect(await applications()).toHaveLength(1);
  const last = reports.at(-1)!;
  expect(last).toMatchObject({ status: "succeeded", dryRun: false, mode: "user" });
  expect(JSON.stringify(last)).not.toMatch(/"otp"|"captcha"/);
  await site.close();
  await panel.close();
}, 120_000);

test("chat mode is disabled with a message when /agent/step returns 503", async () => {
  const { site, panel } = await openPanel(`${demoBase}/status`);
  await panel.getByTestId("tab-chat").click();
  await panel.locator("textarea").fill("check my status");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => panel.getByTestId("chat-disabled").textContent()).toMatch(/not available/);
  await site.close();
  await panel.close();
}, 30_000);
