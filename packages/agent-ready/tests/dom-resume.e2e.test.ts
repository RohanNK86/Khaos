// E3: the DomDriver injected into Portal 1 runs the golden tool across full page reloads (dry run).
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import type { Run } from "@mcpify/contracts";
import { createScholarshipPortal } from "@mcpify/portals";
import { applyInputs, golden, LAB, labState, portOf } from "./helpers.js";

let server: Server;
let base: string;
let browser: Browser;
let harness: string;

beforeAll(async () => {
  server = createScholarshipPortal().listen(0);
  base = `http://localhost:${portOf(server)}`;
  const out = await build({
    entryPoints: [fileURLToPath(new URL("./fixtures/dom-harness.ts", import.meta.url))],
    bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent",
  });
  harness = out.outputFiles[0]!.text;
  browser = await chromium.launch();
});
afterAll(async () => { await browser?.close(); server?.close(); });

test("golden apply_scholarship via DomDriver survives two reloads and stops at Send OTP", async () => {
  await fetch(`${base}/__lab/reset`, { method: "POST", headers: LAB });
  const tool = await golden("apply_scholarship", base);
  const page = await browser.newPage();
  await page.addInitScript({ content: harness });
  await page.goto(`${base}/apply/1`);
  await page.evaluate(([t, i]) => (window as unknown as { __harness: { start(a: unknown, b: unknown): void } }).__harness.start(t, i), [tool, applyInputs] as const);
  const handle = await page.waitForFunction(() => sessionStorage.getItem("harness:result"), undefined, { timeout: 45_000 });
  const run = JSON.parse((await handle.jsonValue()) as string) as Run;
  expect(run.trace.find((t) => t.status === "failed")?.error).toBeUndefined();
  expect(run.status).toBe("dry_run_complete");
  expect(page.url()).toMatch(/\/apply\/3$/);
  const ids = tool.steps.slice(0, tool.steps.findIndex((s) => s.id === "send_otp") + 1).map((s) => s.id);
  expect(run.trace.map((t) => t.stepId)).toEqual(ids);
  expect(run.trace.at(-1)).toMatchObject({ stepId: "send_otp", status: "blocked_dry_run" });
  expect((await labState(base)).applications).toHaveLength(0);
  await page.close();
}, 60_000);
