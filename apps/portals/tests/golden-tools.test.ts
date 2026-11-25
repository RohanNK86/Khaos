/**
 * Validates the Portal 2/3 golden tools and runs them with the real engine against the portals.
 * @mcpify/engine is not a dependency of @mcpify/portals (the engine already dev-depends on portals),
 * so the engine is imported by relative path.
 */
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { Express } from "express";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { SiteSchema, ToolSchema, type Need, type Tool } from "@mcpify/contracts";
import { runTool, type RunHooks } from "../../../packages/engine/src/index.js";
import { createPlaywrightDriver } from "../../../packages/engine/src/playwright.js";
import { createBusPassPortal, createFeesPortal } from "../src/index.js";
import { FILES, lab, listen, otpOf, TOKEN, TOOLS } from "./helpers.js";

/** Values only a human would give; the hooks answer with these. */
const HUMAN = { password: "demo@123", card_number: "4111 1111 1111 1111", card_expiry: "12/30", card_cvv: "123" } as const;
const TOOL_FILES = ["fees.check_dues.v1.json", "fees.pay_semester_fee.v1.json", "buspass.renew_bus_pass.v1.json"];

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function loadTool(file: string, origin: string, base: string): Promise<Tool> {
  const raw = await readFile(new URL(file, TOOLS), "utf8");
  return ToolSchema.parse(JSON.parse(raw.replaceAll(origin, base))) as Tool;
}

/** Hooks that approve confirmations, read the OTP from the lab hook and give test credentials. */
function hooks(base: string, ctx: BrowserContext): RunHooks & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async onNeed(n: Need) {
      if (n.kind === "confirmation") { asked.push(`confirm:${n.stepId}`); return { approve: true }; }
      if (n.kind !== "user_input") return {};
      asked.push(`input:${n.param}`);
      if (n.param === "otp") return { value: await otpOf(base, ctx) };
      return { value: HUMAN[n.param as keyof typeof HUMAN] };
    },
    async loadFile(ref) {
      return { name: ref, mime: ref.endsWith(".png") ? "image/png" : "image/jpeg", bytes: await readFile(new URL(ref, FILES)) };
    },
  };
}

test("golden tools and sites validate against the contracts", async () => {
  for (const f of TOOL_FILES) {
    const t = ToolSchema.parse(JSON.parse(await readFile(new URL(f, TOOLS), "utf8")));
    for (const s of t.steps) if (s.action.type === "userInput") expect(s).toMatchObject({ risk: "auth", repair: "human", sensitive: true });
  }
  const sites = JSON.parse(await readFile(new URL("../sites.json", TOOLS), "utf8")) as unknown[];
  const slugs = sites.map((s) => SiteSchema.parse(s).slug);
  expect(slugs).toEqual(expect.arrayContaining(["scholarship", "fees", "buspass"]));
});

function withPortal(make: () => Express) {
  const p = { server: undefined as Server | undefined, base: "" };
  beforeAll(() => { const l = listen(make()); p.server = l.server; p.base = l.base; });
  afterAll(() => { p.server?.close(); });
  return p;
}

describe("Portal 2 (fees)", () => {
  const p = withPortal(createFeesPortal);
  const ORIGIN = "http://localhost:5102";
  const inputs = { student_id: "DEMO2026001", name_on_card: "Ravi Demo" };

  test("check_dues runs read-only and returns the dues", async () => {
    await fetch(`${p.base}/__lab/reset`, { method: "POST", headers: TOKEN });
    const ctx = await browser.newContext();
    const h = hooks(p.base, ctx);
    const run = await runTool(await loadTool("fees.check_dues.v1.json", ORIGIN, p.base), { student_id: "DEMO2026001" }, createPlaywrightDriver(await ctx.newPage()), h, { dryRun: false, mode: "owner" });
    expect(run.trace.find((t) => t.status === "failed")?.error).toBeUndefined();
    expect(run.status).toBe("succeeded");
    expect(run.outputs).toEqual({ amount_due: "Rs. 45,500.00", due_date: "15-12-2026", fee_status: "Due" });
    expect(h.asked).toEqual(["input:password"]);
    await ctx.close();
  }, 60_000);

  test("pay_semester_fee dry run stops before Pay with no payment recorded", async () => {
    await fetch(`${p.base}/__lab/reset`, { method: "POST", headers: TOKEN });
    const ctx = await browser.newContext();
    const run = await runTool(await loadTool("fees.pay_semester_fee.v1.json", ORIGIN, p.base), inputs, createPlaywrightDriver(await ctx.newPage()), hooks(p.base, ctx), { dryRun: true, mode: "owner" });
    expect(run.status).toBe("dry_run_complete");
    expect(run.trace.at(-1)).toMatchObject({ stepId: "pay", status: "blocked_dry_run" });
    expect((await lab<{ payments: unknown[] }>(p.base, "state")).payments).toHaveLength(0);
    await ctx.close();
  }, 60_000);

  test("pay_semester_fee pays with the human's card, confirmation and OTP", async () => {
    await fetch(`${p.base}/__lab/reset`, { method: "POST", headers: TOKEN });
    const ctx = await browser.newContext();
    const h = hooks(p.base, ctx);
    const run = await runTool(await loadTool("fees.pay_semester_fee.v1.json", ORIGIN, p.base), inputs, createPlaywrightDriver(await ctx.newPage()), h, { dryRun: false, mode: "owner" });
    expect(run.trace.find((t) => t.status === "failed")?.error).toBeUndefined();
    expect(run.status).toBe("succeeded");
    expect(run.outputs).toEqual({ receipt_number: "UFP-RCPT-2026-00001", amount_paid: "Rs. 45,500.00" });
    expect(h.asked).toEqual(["input:password", "input:card_number", "input:card_expiry", "input:card_cvv", "confirm:pay", "input:otp"]);
    const json = JSON.stringify(run);
    for (const secret of [HUMAN.password, "4111 1111 1111 1111", HUMAN.card_cvv + '"']) expect(json).not.toContain(secret);
    expect((await lab<{ payments: unknown[] }>(p.base, "state")).payments).toHaveLength(1);
    await ctx.close();
  }, 60_000);
});

describe("Portal 3 (buspass)", () => {
  const p = withPortal(createBusPassPortal);
  const inputs = {
    pass_number: "BPS-2025-004217", date_of_birth: "2004-08-19", confirm_details: true, photo: "sample-student-photo.png",
    route: "Route 12: Railway Station - Demo Government College", from_date: "2026-12-01", to_date: "2027-05-31",
  };

  test("renew_bus_pass renews the pass and returns the new pass number", async () => {
    await fetch(`${p.base}/__lab/reset`, { method: "POST", headers: TOKEN });
    const ctx = await browser.newContext();
    const h = hooks(p.base, ctx);
    const run = await runTool(await loadTool("buspass.renew_bus_pass.v1.json", "http://localhost:5103", p.base), inputs, createPlaywrightDriver(await ctx.newPage()), h, { dryRun: false, mode: "owner" });
    expect(run.trace.find((t) => t.status === "failed")?.error).toBeUndefined();
    expect(run.status).toBe("succeeded");
    expect(run.outputs.pass_number).toMatch(/^BPS-2026-\d{6}$/);
    expect(h.asked).toEqual(["confirm:send_otp", "input:otp", "confirm:submit_renewal"]);
    expect((await lab<{ renewals: unknown[] }>(p.base, "state")).renewals).toHaveLength(1);
    await ctx.close();
  }, 60_000);
});
