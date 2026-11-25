import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createFeesPortal } from "../src/index.js";
import { lab, listen, otpOf, TOKEN } from "./helpers.js";

let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  ({ server, base } = listen(createFeesPortal()));
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(async () => { await fetch(`${base}/__lab/reset`, { method: "POST", headers: TOKEN }); });

async function login(page: Page, password = "demo@123") {
  await page.goto(`${base}/login`);
  await page.fill("#txtStudentId", "DEMO2026001");
  await page.fill("#txtPassword", password);
  await page.click("#btnLogin");
}

test("every page shows the DEMO banner and lab hooks need the token", async () => {
  for (const p of ["/", "/login"]) expect(await (await fetch(base + p)).text()).toContain('id="demoBanner"');
  expect((await fetch(`${base}/__lab/state`)).status).toBe(401);
  expect(await lab(base, "state")).toEqual({ mutations: [], applications: [], payments: [] });
});

test("wrong password stays on the login page with an error", async () => {
  const page = await browser.newPage();
  await login(page, "wrong");
  expect(await page.textContent("#lblLoginError")).toContain("Invalid");
  expect(page.url()).toMatch(/\/login$/);
  await page.close();
});

test("login → dues → simulated payment → OTP → receipt", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page);
  await page.waitForURL(/\/dues$/);
  expect(await page.textContent("#lblAmountDue")).toBe("Rs. 45,500.00");
  expect(await page.textContent("#lblFeeStatus")).toBe("Due");

  await page.click("#btnPayFee");
  await page.waitForURL(/\/pay$/);
  expect(await page.textContent("body")).toContain("This is a simulation; no money moves");
  await page.fill("#txtCardNumber", "4000 0000 0000 0002");
  await page.fill("#txtExpiry", "12/30");
  await page.fill("#txtCvv", "123");
  await page.fill("#txtCardName", "Ravi Demo");
  await page.click("#btnPay");
  expect(await page.textContent("#txtCardNumber_err")).toContain("only the DEMO test card");

  await page.fill("#txtCardNumber", "4111 1111 1111 1111");
  await page.fill("#txtExpiry", "12/30");
  await page.fill("#txtCvv", "123");
  await page.click("#btnPay");
  await page.waitForURL(/\/pay\/verify$/);
  expect((await lab<{ payments: unknown[] }>(base, "state")).payments).toHaveLength(0);
  await page.fill("#txtOtp", await otpOf(base, ctx));
  await page.click("#btnSubmitOtp");
  await page.waitForURL(/\/pay\/receipt$/);
  expect(await page.textContent("#lblReceiptNo")).toBe("UFP-RCPT-2026-00001");

  const state = await lab<{ payments: { cardLast4: string; amount: number }[] }>(base, "state");
  expect(state.payments).toEqual([expect.objectContaining({ cardLast4: "1111", amount: 45500 })]);
  expect(JSON.stringify(state)).not.toContain("4111111111111111");
  await page.goto(`${base}/dues`);
  expect(await page.textContent("#lblFeeStatus")).toBe("Paid");
  await ctx.close();
}, 30_000);

test("dues and payment pages need a login", async () => {
  for (const p of ["/dues", "/pay", "/pay/verify"]) {
    const res = await fetch(base + p, { redirect: "manual" });
    expect(res.headers.get("location")).toBe("/login");
  }
});
