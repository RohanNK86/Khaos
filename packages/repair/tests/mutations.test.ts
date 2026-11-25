/**
 * Layout Lab mutations M1–M10 on Portal 1 → engine outcome → repairStep outcome.
 * Writes packages/repair/RESULTS.md. Every repair sandbox run is a dry run: /__lab/state must show no applications.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { ToolSchema, type Run, type Tool } from "@mcpify/contracts";
import { createScholarshipPortal } from "@mcpify/portals";
import { runTool, type RunHooks } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";
import {
  applyOptionAliases, applyProposal, failedChecksFromRun, optionAliases, repairAndRetry, repairStep, type RepairDraft,
} from "../src/index.js";

process.env.LLM_DISABLED = "1"; // no credentials in CI: tier 3 must be skipped cleanly

const root = new URL("../../../", import.meta.url);
const TOKEN = { "x-lab-token": "changeme", "content-type": "application/json" };
let server: Server;
let base: string;
let browser: Browser;
let golden: Tool;

const inputs = {
  applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210",
  email: "asha.demo@example.com", course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College",
  annual_income: 180000, category: "OBC", declaration: true, income_certificate: "sample-income-certificate.pdf",
};
const loadFile: RunHooks["loadFile"] = async (ref) =>
  ({ name: ref, mime: "application/pdf", bytes: await readFile(new URL(`fixtures/files/${ref}`, root)) });

interface Row { id: string; change: string; engine: string; failed: string; method: string; confidence: string; sandbox: string; status: string; rerun: string; expected: string }
const rows: Row[] = [];
const row = (r: Partial<Row> & Pick<Row, "id" | "change" | "expected">) =>
  rows.push({ engine: "", failed: "-", method: "-", confidence: "-", sandbox: "-", status: "-", rerun: "-", ...r });

const retarget = (t: Tool): Tool => ToolSchema.parse(JSON.parse(JSON.stringify(t).replaceAll("http://localhost:5101", base))) as Tool;

async function lab(path: string, body?: unknown) {
  const r = await fetch(`${base}/__lab/${path}`, body === undefined ? { headers: TOKEN } : { method: "POST", headers: TOKEN, body: JSON.stringify(body) });
  return r.json() as Promise<Record<string, unknown>>;
}
/** Reset the portal and enable exactly these mutations; returns false if the portal doesn't know one. */
async function mutate(...ms: string[]): Promise<boolean> {
  await lab("reset", {});
  const r = (await lab("mutations", { enable: ms, disable: [] })) as { mutations: string[] };
  return ms.every((m) => r.mutations.includes(m));
}
const applications = async () => ((await lab("state")) as { applications: unknown[] }).applications.length;

function labHooks(ctx: BrowserContext, blobs: string[]): RunHooks {
  const secret = async (what: string) => {
    const sid = (await ctx.cookies()).find((c) => c.name === "ASP.NET_SessionId")!.value;
    return (await lab(`${what}?session=${sid}`))[what] as string;
  };
  return {
    onNeed: async (n) => (n.kind === "confirmation" ? { approve: true } : { value: await secret(n.param === "otp" ? "otp" : "captcha") }),
    saveBlob: async (content) => { blobs.push(content); return `mem-${blobs.length - 1}`; },
    loadFile,
  };
}

/** Run a tool; returns the run, the failure evidence HTML and the final page HTML. */
async function run(tool: Tool, opts: { dryRun?: boolean; inputs?: Record<string, unknown> } = {}) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const blobs: string[] = [];
    const r = await runTool(tool, opts.inputs ?? inputs, createPlaywrightDriver(page), labHooks(ctx, blobs), { dryRun: opts.dryRun ?? true, mode: "owner" });
    return { run: r, evidence: blobs.at(-1) ?? "", final: await page.content() };
  } finally {
    await ctx.close();
  }
}
const engineSays = (r: Run) => (r.status === "failed" ? `failed at ${r.failedStepId}` : r.status === "dry_run_complete" ? "passes (dry run to Send OTP)" : r.status);

async function repair(tool: Tool, r: Run, evidence: string): Promise<RepairDraft> {
  const before = await applications();
  const p = await repairStep({
    tool, failedStepId: r.failedStepId!, evidenceHtml: evidence, failedChecks: failedChecksFromRun(r),
    evidenceBlobId: "mem", browser, sandbox: { inputs, loadFile, browser },
  });
  expect(await applications()).toBe(before); // the sandbox never submits anything
  return p;
}
const repaired = (p: RepairDraft) => ({
  method: p.method, confidence: p.confidence.toFixed(2), status: `**${p.status}**`,
  sandbox: p.sandbox.detail.startsWith("sandbox not run") ? "not run" : p.sandbox.passed ? "passed" : "failed",
});

/** Variant of the golden tool where a Next step has only role/text locators (as a recorder without stable ids would). */
function nextByTextOnly(t: Tool, stepId: string, risk: "fill" | "commit"): Tool {
  const locs = [{ kind: "role", role: "button", name: "Next" }, { kind: "text", value: "Next" }];
  return ToolSchema.parse({
    ...t,
    steps: t.steps.map((s) => (s.id !== stepId ? s : {
      ...s, locators: locs, pre: [{ kind: "visible", locators: locs }], risk, repair: risk === "fill" ? "auto" : "human", timeoutMs: 4000,
    })),
  }) as Tool;
}

beforeAll(async () => {
  server = createScholarshipPortal().listen(0);
  const a = server.address();
  base = `http://localhost:${typeof a === "object" && a ? a.port : 0}`;
  browser = await chromium.launch();
  golden = retarget(JSON.parse(await readFile(new URL("fixtures/tools/scholarship.apply_scholarship.v1.json", root), "utf8")));
});

afterAll(async () => {
  await browser?.close();
  server?.close();
  const order = (id: string) => Number(id.match(/M(\d+)/)?.[1] ?? 0) * 10 + (id.includes("+") ? 1 : 0) + (id.includes("variant") ? 2 : 0);
  rows.sort((x, y) => order(x.id) - order(y.id));
  const head = "| Mutation | Change | Engine (golden tool, dry run) | Failed step | Repair method | Confidence | Sandbox (dry run) | Repair status | Rerun of patched tool | Expected (MUTATIONS.md) |\n|---|---|---|---|---|---|---|---|---|---|\n";
  const body = rows.map((r) => `| ${r.id} | ${r.change} | ${r.engine} | ${r.failed} | ${r.method} | ${r.confidence} | ${r.sandbox} | ${r.status} | ${r.rerun} | ${r.expected} |`).join("\n");
  await writeFile(new URL("../RESULTS.md", import.meta.url), `# Verified Selective Repair: Layout Lab results (Portal 1)

Generated by \`pnpm --filter @mcpify/repair test\` (tests/mutations.test.ts) on ${new Date().toISOString().slice(0, 10)}.
Golden tool \`fixtures/tools/scholarship.apply_scholarship.v1.json\`, legacy (non-owner) pages, so \`testid\` locators do not resolve.
LLM tier disabled (no credentials); every sandbox replay is an engine dry run, and \`/__lab/state\` showed **no applications created by any repair**.

${head}${body}
`);
});

describe("Layout Lab mutations", () => {
  test("baseline: golden tool passes without mutations", async () => {
    await mutate();
    const { run: r } = await run(golden);
    expect(r.status).toBe("dry_run_complete");
  }, 60_000);

  const harmless: [string, string, string][] = [
    ["M1", "income label renamed", "passes via id fallback"],
    ["M2", "income id/name renamed", "passes via label"],
    ["M4", "page-2 fields reordered", "engine still passes"],
    ["M5", "page 2 wrapped (CSS paths change)", "passes (no css/xpath locators used)"],
    ["M10", "CSS classes renamed", "engine still passes"],
  ];
  for (const [m, change, expected] of harmless) {
    test(`${m}: engine passes without repair`, async () => {
      expect(await mutate(m)).toBe(true);
      const { run: r } = await run(golden);
      expect(r.status).toBe("dry_run_complete");
      const used = r.trace.find((t) => t.stepId === "enter_annual_income")?.usedLocator?.kind;
      row({ id: m, change, expected, engine: `${engineSays(r)}; income via \`${used}\`` });
    }, 60_000);
  }

  test("M1+M2: income label AND id/name changed → heuristic auto-repair, patched tool reruns", async () => {
    expect(await mutate("M1", "M2")).toBe(true);
    const { run: r, evidence } = await run(golden);
    expect(r.failedStepId).toBe("enter_annual_income");
    const p = await repair(golden, r, evidence);
    expect(p.method).toBe("heuristic");
    expect(p.confidence).toBeGreaterThanOrEqual(0.8);
    expect(p.sandbox.passed).toBe(true);
    expect(p.status).toBe("auto_applied");
    expect(p.proposedStep.locators).toContainEqual({ kind: "id", value: "ctl00_ContentPlaceHolder1_txtFamIncome" });
    expect(p.proposedStep.locators).toContainEqual({ kind: "label", value: "Family Income (per annum)" });
    expect(p.proposedStep.post[0]).toMatchObject({ kind: "valueEquals", locators: p.proposedStep.locators });
    // Freeze: nothing else changed.
    const { locators: _l, pre: _p, post: _q, ...rest } = p.proposedStep;
    const { locators: _l2, pre: _p2, post: _q2, ...orig } = golden.steps.find((s) => s.id === p.stepId)!;
    expect(rest).toEqual(orig);
    const patched = applyProposal(golden, p);
    expect(patched.version).toBe(2);
    const again = await run(patched);
    expect(again.run.status).toBe("dry_run_complete");
    expect(await applications()).toBe(0);
    row({ id: "M1+M2", change: "income label + id/name both changed", expected: "auto-repair", engine: engineSays(r), failed: r.failedStepId!, ...repaired(p), rerun: `v${patched.version}: ${engineSays(again.run)}` });
  }, 120_000);

  test("M7: Next → Continue; golden tool still passes via id", async () => {
    expect(await mutate("M7")).toBe(true);
    const { run: r } = await run(golden);
    expect(r.status).toBe("dry_run_complete");
    row({ id: "M7", change: 'Next → "Continue"', expected: "auto-repair (Next is fill)", engine: `${engineSays(r)}; Next via \`${r.trace.find((t) => t.stepId === "continue_to_academic_details")?.usedLocator?.kind}\`` });
  }, 60_000);

  test("M7 variant (Next located by text only, fill) → heuristic auto-repair via role/text", async () => {
    expect(await mutate("M7")).toBe(true);
    const tool = nextByTextOnly(golden, "continue_to_academic_details", "fill");
    const { run: r, evidence } = await run(tool);
    expect(r.failedStepId).toBe("continue_to_academic_details");
    const p = await repair(tool, r, evidence);
    expect(p.method).toBe("heuristic");
    expect(p.status).toBe("auto_applied");
    expect(p.proposedStep.locators).toContainEqual({ kind: "text", value: "Continue" });
    const patched = applyProposal(tool, p);
    const again = await run(patched);
    expect(again.run.status).toBe("dry_run_complete");
    row({ id: "M7 variant (fill)", change: "Next located only by role/text", expected: "auto-repair", engine: engineSays(r), failed: r.failedStepId!, ...repaired(p), rerun: engineSays(again.run) });
  }, 120_000);

  test("M7 variant on a commit step → pending (never auto-applied)", async () => {
    expect(await mutate("M7")).toBe(true);
    const tool = nextByTextOnly(golden, "continue_to_academic_details", "commit");
    const { run: r, evidence } = await run(tool);
    expect(r.failedStepId).toBe("continue_to_academic_details");
    const p = await repair(tool, r, evidence);
    expect(p.reversible).toBe(false);
    expect(p.sandbox.passed).toBe(false); // the engine blocks commit steps in dry run
    expect(p.status).toBe("pending");
    row({ id: "M7 variant (commit)", change: "same, step marked commit", expected: "pending (owner approves)", engine: engineSays(r), failed: r.failedStepId!, ...repaired(p) });
  }, 120_000);

  test("M3: Submit above OTP → engine passes; a forced repair of the commit step is pending", async () => {
    expect(await mutate("M3")).toBe(true);
    const dry = await run(golden);
    expect(dry.run.status).toBe("dry_run_complete");
    const p = await repairStep({
      tool: golden, failedStepId: "submit_application", evidenceHtml: dry.final, failedChecks: ["forced: owner asked to re-verify Submit"],
      browser, sandbox: { inputs, loadFile, browser },
    });
    expect(await applications()).toBe(0);
    expect(p.method).toBe("locator_fallback");
    expect(p.reversible).toBe(false);
    expect(p.status).toBe("pending");
    const live = await run(golden, { dryRun: false });
    expect(live.run.status).toBe("succeeded");
    row({ id: "M3", change: "Submit moved above OTP", expected: "commit step → pending", engine: `${engineSays(dry.run)}; live run: ${live.run.status}`, failed: "submit_application (forced)", ...repaired(p) });
  }, 120_000);

  test("M8: new required Aadhaar field → needs_rerecord", async () => {
    expect(await mutate("M8")).toBe(true);
    const { run: r, evidence } = await run(golden);
    expect(r.failedStepId).toBe("continue_to_academic_details");
    const p = await repair(golden, r, evidence);
    expect(p.status).toBe("needs_rerecord");
    expect(p.reason).toMatch(/Aadhaar/);
    expect(p.proposedStep).toEqual(golden.steps.find((s) => s.id === p.stepId));
    row({ id: "M8", change: "new required Aadhaar field", expected: "stop safely, needs_rerecord", engine: engineSays(r), failed: r.failedStepId!, ...repaired(p) });
  }, 120_000);

  test("M9: course options relabelled → option mapping, pending (contract has no mapping field)", async () => {
    expect(await mutate("M9")).toBe(true);
    const { run: r, evidence } = await run(golden);
    expect(r.failedStepId).toBe("select_course");
    const p = await repair(golden, r, evidence);
    const al = optionAliases(p)!;
    expect(al.course).toMatchObject({ "B.Sc": "Bachelor of Science", "B.Com": "Bachelor of Commerce", "B.A": "Bachelor of Arts", "B.E": "Bachelor of Engineering" });
    expect(p.sandbox.passed).toBe(true);
    expect(p.status).toBe("pending");
    const again = await run(golden, { inputs: applyOptionAliases(inputs, al) });
    expect(again.run.status).toBe("dry_run_complete");
    row({ id: "M9", change: "course options relabelled", expected: "auto-repair via option mapping", engine: engineSays(r), failed: r.failedStepId!, ...repaired(p), rerun: `with translated inputs: ${engineSays(again.run)}` });
  }, 120_000);

  test("M6: page 2 split → needs_rerecord", async (ctx) => {
    if (!(await mutate("M6"))) { ctx.skip(); return; }
    const { run: r, evidence } = await run(golden);
    expect(r.status).toBe("failed");
    const p = await repair(golden, r, evidence);
    expect(p.status).toBe("needs_rerecord");
    row({ id: "M6", change: "page 2 split into 2a/2b", expected: "needs_rerecord", engine: engineSays(r), failed: r.failedStepId!, ...repaired(p) });
  }, 120_000);

  test("repairAndRetry: auto-applies and resumes from the failed step (RunManager path)", async () => {
    expect(await mutate("M1", "M2")).toBe(true);
    const { run: r, evidence } = await run(golden);
    const ctx = await browser.newContext();
    try {
      const out = await repairAndRetry({
        run: r, tool: golden, evidenceHtml: evidence, inputs, loadFile, browser,
        retry: async (patched) => runTool(patched, inputs, createPlaywrightDriver(await ctx.newPage()), { onNeed: async () => ({}) }, { dryRun: true, mode: "owner" }),
      });
      expect(out.proposal.status).toBe("auto_applied");
      expect(out.patched?.version).toBe(2);
      expect(out.retried?.status).toBe("dry_run_complete");
    } finally {
      await ctx.close();
    }
  }, 120_000);
});

