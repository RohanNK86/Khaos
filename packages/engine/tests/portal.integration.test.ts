import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { ToolSchema, type Tool } from "@mcpify/contracts";
import { createScholarshipPortal } from "@mcpify/portals";
import { runTool, type RunHooks } from "../src/index.js";
import { createPlaywrightDriver } from "../src/playwright.js";
import { installNetworkGuard } from "../src/network-guard.js";

const root = new URL("../../../", import.meta.url);
const TOKEN = { "x-lab-token": "changeme" };
let server: Server;
let base: string;
let browser: Browser;
let golden: Tool;

/** Point the golden tool at the test portal's port. */
const retarget = (t: Tool): Tool => ToolSchema.parse(JSON.parse(JSON.stringify(t).replaceAll("http://localhost:5101", base))) as Tool;

beforeAll(async () => {
  server = createScholarshipPortal().listen(0);
  const a = server.address();
  base = `http://localhost:${typeof a === "object" && a ? a.port : 0}`;
  browser = await chromium.launch();
  golden = retarget(JSON.parse(await readFile(new URL("fixtures/tools/scholarship.apply_scholarship.v1.json", root), "utf8")));
});
afterAll(async () => { await browser?.close(); server?.close(); });
beforeEach(async () => { await fetch(`${base}/__lab/reset`, { method: "POST", headers: TOKEN }); });

const inputs = {
  applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210",
  email: "asha.demo@example.com", course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College",
  annual_income: 180000, category: "OBC", declaration: true, income_certificate: "sample-income-certificate.pdf",
};

function labHooks(ctx: BrowserContext): RunHooks & { asked: string[] } {
  const asked: string[] = [];
  const lab = async (what: "otp" | "captcha") => {
    const sid = (await ctx.cookies()).find((c) => c.name === "ASP.NET_SessionId")!.value;
    return ((await (await fetch(`${base}/__lab/${what}?session=${sid}`, { headers: TOKEN })).json()) as Record<string, string>)[what]!;
  };
  return {
    asked,
    async onNeed(n) {
      asked.push(n.kind === "confirmation" ? `confirm:${n.stepId}` : `input:${n.param}`);
      if (n.kind === "confirmation") return { approve: true };
      return { value: await lab(n.param === "otp" ? "otp" : "captcha") };
    },
    async loadFile(ref) {
      return { name: ref, mime: "application/pdf", bytes: await readFile(new URL(`fixtures/files/${ref}`, root)) };
    },
  };
}

test("golden tool applies end to end on Portal 1", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const h = labHooks(ctx);
  const run = await runTool(golden, inputs, createPlaywrightDriver(page), h, { dryRun: false, mode: "owner" });
  expect(run.trace.find((t) => t.status === "failed")?.error).toBeUndefined();
  expect(run.status).toBe("succeeded");
  expect(run.outputs.application_id).toMatch(/^SSP-2026-\d{6}$/);
  expect(h.asked).toEqual(["confirm:send_otp", "input:otp", "input:captcha", "confirm:submit_application"]);
  expect(JSON.stringify(run)).not.toMatch(/"otp":"\d{6}"/);
  const state = (await (await fetch(`${base}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
  expect(state.applications).toHaveLength(1);
  await ctx.close();
}, 60_000);

test("dry run fills pages 1-2, stops at Send OTP, creates nothing", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const h = labHooks(ctx);
  const run = await runTool(golden, inputs, createPlaywrightDriver(page), h, { dryRun: true, mode: "owner" });
  expect(run.status).toBe("dry_run_complete");
  expect(run.trace.at(-1)).toMatchObject({ stepId: "send_otp", status: "blocked_dry_run" });
  expect(h.asked).toEqual([]);
  const state = (await (await fetch(`${base}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
  expect(state.applications).toHaveLength(0);
  await ctx.close();
}, 60_000);

test("M4 + M5 + M10 (reorder, wrap, class rename): engine still passes", async () => {
  await fetch(`${base}/__lab/mutations`, { method: "POST", headers: { ...TOKEN, "content-type": "application/json" }, body: JSON.stringify({ enable: ["M4", "M5", "M10"], disable: [] }) });
  const ctx = await browser.newContext();
  const run = await runTool(golden, inputs, createPlaywrightDriver(await ctx.newPage()), labHooks(ctx), { dryRun: true, mode: "owner" });
  expect(run.status).toBe("dry_run_complete");
  await ctx.close();
}, 60_000);

test("M1 + M2 (label and id renamed): the income step fails cleanly, before anything is sent", async () => {
  await fetch(`${base}/__lab/mutations`, { method: "POST", headers: { ...TOKEN, "content-type": "application/json" }, body: JSON.stringify({ enable: ["M1", "M2"], disable: [] }) });
  const ctx = await browser.newContext();
  const step = (id: string) => ({ ...golden.steps.find((s) => s.id === id)!, timeoutMs: 1500 });
  const tool = { ...golden, steps: golden.steps.map((s) => (s.id === "enter_annual_income" ? step(s.id) : s)) };
  const run = await runTool(tool, inputs, createPlaywrightDriver(await ctx.newPage()), labHooks(ctx), { dryRun: false, mode: "owner" });
  expect(run).toMatchObject({ status: "failed", failedStepId: "enter_annual_income" });
  await ctx.close();
}, 60_000);

test("M8 (new required field) fails safely at the Next step with the portal's message", async () => {
  await fetch(`${base}/__lab/mutations`, { method: "POST", headers: { ...TOKEN, "content-type": "application/json" }, body: JSON.stringify({ enable: ["M8"], disable: [] }) });
  const ctx = await browser.newContext();
  const run = await runTool(golden, inputs, createPlaywrightDriver(await ctx.newPage()), labHooks(ctx), { dryRun: false, mode: "owner" });
  expect(run).toMatchObject({ status: "failed", failedStepId: "continue_to_academic_details" });
  expect(run.trace.at(-1)!.error).toMatch(/required/i);
  await ctx.close();
}, 60_000);

test("network guard blocks the form POST even if a click gets through", async () => {
  const ctx = await browser.newContext();
  const blocked = await installNetworkGuard(ctx);
  const page = await ctx.newPage();
  await page.goto(`${base}/apply/1`);
  await page.fill("#ctl00_ContentPlaceHolder1_txtApplicantName", "Asha Demo");
  await page.click("#ctl00_ContentPlaceHolder1_btnNext1").catch(() => undefined);
  await page.waitForTimeout(500);
  expect(blocked.map((b) => b.method)).toContain("POST");
  expect(page.url()).not.toMatch(/apply\/2/);
  await ctx.close();
}, 30_000);
