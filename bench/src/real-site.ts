/**
 * Real-website DRY RUN (C17-lite). Nothing is ever sent:
 *  1. the engine runs with dryRun=true (commit steps are blocked), and
 *  2. a network guard aborts every non-GET request and logs it.
 *
 *   pnpm --filter @mcpify/bench real-site probe <url> --out real-site/<name>
 *       → reads the form on <url>, writes <name>.tool.json + <name>.inputs.json to edit
 *   pnpm --filter @mcpify/bench real-site run real-site/<name> [--video]
 *       → visible browser fills the form in dry-run, prints the verified steps and blocked requests
 *
 * Rules: read the site's terms first; skip sites that forbid automation; no login; never a real OTP;
 * never solve CAPTCHAs; use dummy values or a consenting teammate's own details; a handful of runs only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { ToolSchema, type Locator, type StepContract, type Tool } from "@mcpify/contracts";
import { runTool } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";
import { installNetworkGuard } from "@mcpify/engine/network-guard";
import { IN_PAGE_JS } from "@mcpify/engine/in-page";

const BENCH = new URL("..", import.meta.url).pathname;
/** bench/real-site/... and bench/results/... always live in the bench folder; other paths are relative to where you typed. */
const here = (p: string) =>
  /^(real-site|results)\//.test(p) ? resolve(BENCH, p) : resolve(process.env.INIT_CWD ?? process.cwd(), p);
const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (f: string) => rest.includes(f);
const opt = (f: string) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : undefined);

interface ProbedField { tag: string; type: string; id: string; name: string; label: string; options: string[]; text: string }

async function probe(url: string, out: string) {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const blocked = await installNetworkGuard(ctx);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  console.log("Page loaded. Close any popups in the browser, then press Enter here to read the form...");
  await new Promise((r) => process.stdin.once("data", r));
  const fields = (await page.evaluate(`(${IN_PAGE_JS}, Array.from(document.querySelectorAll("input:not([type=hidden]),select,textarea,button,input[type=submit]"))
    .filter((e) => e.getClientRects().length > 0)
    .map((e) => ({ tag: e.tagName.toLowerCase(), type: (e.type || "").toLowerCase(), id: e.id || "", name: e.getAttribute("name") || "",
      label: (window.__mcpify.labelsOf(e)[0] || ""), options: e.tagName === "SELECT" ? Array.from(e.options).map((o) => o.text.trim()) : [],
      text: (e.tagName === "INPUT" ? e.value : e.innerText || "").trim().slice(0, 40) })))`)) as ProbedField[];
  await browser.close();

  const steps: StepContract[] = [{ id: "open_form", intent: "Open the form", action: { type: "navigate", url }, locators: [], pre: [], post: [], risk: "read", repair: "auto" }];
  const props: Record<string, unknown> = {};
  const inputs: Record<string, unknown> = {};
  const used = new Set<string>();
  const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 40) || "field";
  for (const f of fields) {
    const isButton = f.tag === "button" || ["submit", "button", "reset", "image"].includes(f.type);
    const locators: Locator[] = [
      ...(f.id && !/\d{4,}/.test(f.id) ? [{ kind: "id", value: f.id } as const] : []),
      ...(f.name ? [{ kind: "name", value: f.name } as const] : []),
      ...(f.label && !isButton ? [{ kind: "label", value: f.label } as const] : []),
      ...(isButton && f.text ? [{ kind: "text", value: f.text } as const] : []),
    ].slice(0, 5);
    if (!locators.length) continue;
    let param = snake(isButton ? f.text || f.name || f.id : f.label || f.name || f.id);
    while (used.has(param)) param += "_2";
    used.add(param);
    if (isButton) {
      steps.push({ id: `click_${param}`, intent: `Click "${f.text}" (sends data: blocked in dry-run)`, action: { type: "click" }, locators, pre: [{ kind: "visible", locators }], post: [], risk: "commit", repair: "human" });
      continue;
    }
    if (/captcha|otp|password/i.test(`${f.label} ${f.name} ${f.id}`)) continue; // humans only, never automated here
    const type = f.tag === "select" ? "select" : f.type === "checkbox" ? "check" : "fill";
    steps.push({ id: `enter_${param}`, intent: `Fill "${f.label || f.name}"`, action: { type, param }, locators, pre: [{ kind: "visible", locators }],
      post: type === "check" ? [] : [{ kind: "valueEquals", locators, param }], risk: "fill", repair: "auto" });
    props[param] = f.tag === "select" ? { type: "string", enum: f.options.filter((o) => o && !/^-*\s*select/i.test(o)), title: f.label } : { type: f.type === "checkbox" ? "boolean" : "string", title: f.label || f.name };
    inputs[param] = f.tag === "select" ? f.options.find((o) => o && !/^-*\s*select/i.test(o)) ?? "" : f.type === "checkbox" ? true : "DUMMY";
  }
  const now = new Date().toISOString();
  const tool = ToolSchema.parse({
    id: crypto.randomUUID(), siteId: "site-real", name: snake(new URL(url).hostname.split(".")[0] + "_form"), title: `Form on ${new URL(url).hostname}`,
    description: "Probed from a real website. DRY RUN ONLY.", version: 1, status: "draft",
    inputSchema: { type: "object", properties: props, required: [] }, outputs: [], startUrl: url, steps, createdAt: now, updatedAt: now,
  });
  mkdirSync(dirname(here(out)), { recursive: true });
  writeFileSync(here(`${out}.tool.json`), JSON.stringify(tool, null, 2) + "\n");
  writeFileSync(here(`${out}.inputs.json`), JSON.stringify(inputs, null, 2) + "\n");
  console.log(`${fields.length} controls found → ${steps.length} steps. ${blocked.length} sending requests were blocked while probing.`);
  console.log(`Edit ${out}.tool.json (delete steps you don't need) and ${out}.inputs.json (dummy values), then: real-site run ${out}`);
}

async function run(base: string) {
  const tool = ToolSchema.parse(JSON.parse(readFileSync(here(`${base}.tool.json`), "utf8"))) as Tool;
  const inputs = JSON.parse(readFileSync(here(`${base}.inputs.json`), "utf8")) as Record<string, unknown>;
  const browser = await chromium.launch({ headless: flag("--headless") });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, ...(flag("--video") ? { recordVideo: { dir: here("results/raw/videos"), size: { width: 1200, height: 860 } } } : {}) });
  const blocked = await installNetworkGuard(ctx, (b) => console.log(`  ⛔ blocked ${b.method} ${b.url}`));
  const page = await ctx.newPage();
  const t0 = Date.now();
  const result = await runTool(tool, inputs, createPlaywrightDriver(page, { showActions: true, actionDelayMs: Number(opt("--delay") ?? 400) }), {
    onNeed: async () => ({ approve: false }), // never reached in dry-run; refuse anything just in case
    onStep: (t) => t.status !== "awaiting" && console.log(`  ${{ passed: "✓", failed: "✗", blocked_dry_run: "⛔", skipped: "–", awaiting: "…" }[t.status]} ${t.stepId}${t.usedLocator ? `  (found by ${t.usedLocator.kind})` : ""}${t.error ? `  ${t.error}` : ""}`),
  }, { dryRun: true, mode: "user" });
  console.log(`\n${result.status}: ${result.trace.filter((t) => t.status === "passed").length} steps verified in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${blocked.length} sending request(s) blocked; nothing was sent.`);
  await page.waitForTimeout(Number(opt("--hold") ?? 4000));
  await ctx.close();
  await browser.close();
  if (flag("--video")) console.log(`video saved under ${here("results/raw/videos")}`);
}

if (cmd === "probe" && target) await probe(target, opt("--out") ?? "real-site/site");
else if (cmd === "run" && target) await run(target);
else {
  console.log("usage: real-site probe <url> --out real-site/<name> | real-site run real-site/<name> [--video] [--headless] [--delay ms]");
  process.exit(1);
}
