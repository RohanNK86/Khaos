import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type Browser } from "playwright";
import { createScholarshipPortal } from "../src/index.js";

const CERT = fileURLToPath(new URL("../../../fixtures/files/sample-income-certificate.pdf", import.meta.url));
const TOKEN = { "x-lab-token": "changeme" };
let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  server = createScholarshipPortal().listen(0);
  const addr = server.address();
  base = `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}`;
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

const id = (s: string) => `#ctl00_ContentPlaceHolder1_${s}`;

test("lab hooks need the token", async () => {
  expect((await fetch(`${base}/__lab/state`)).status).toBe(401);
  expect((await fetch(`${base}/__lab/state`, { headers: TOKEN })).status).toBe(200);
});

test("full scholarship application gives an Application ID", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/apply/1`);
  await page.fill(id("txtApplicantName"), "Asha Demo");
  await page.fill(id("txtDOB"), "2005-04-12");
  await page.selectOption(id("ddlGender"), { label: "Female" });
  await page.fill(id("txtMobile"), "9876543210");
  await page.fill(id("txtEmail"), "asha.demo@example.com");
  await page.click(id("btnNext1"));
  await page.waitForURL(/\/apply\/2$/);

  await page.selectOption(id("ddlCourse"), { label: "B.Sc" });
  await page.selectOption(id("ddlYear"), { label: "2nd Year" });
  await page.fill(id("txtInstitution"), "Demo Government College");
  await page.fill(id("txtIncome"), "180000");
  await page.selectOption(id("ddlCategory"), { label: "OBC" });
  await page.check(id("chkDeclare"));
  await page.click(id("btnNext2"));
  await page.waitForURL(/\/apply\/3$/);

  await page.click(id("btnSendOtp"));
  await page.waitForSelector(id("lblOtpMsg"));
  const sid = (await ctx.cookies()).find((c) => c.name === "ASP.NET_SessionId")!.value;
  const { otp } = (await (await fetch(`${base}/__lab/otp?session=${sid}`, { headers: TOKEN })).json()) as { otp: string };
  const { captcha } = (await (await fetch(`${base}/__lab/captcha?session=${sid}`, { headers: TOKEN })).json()) as { captcha: string };
  await page.setInputFiles(id("fuIncomeCert"), CERT);
  await page.fill(id("txtOTP"), otp);
  await page.fill(id("txtCaptcha"), captcha);
  await page.click(id("btnSubmit"));
  await page.waitForURL(/\/apply\/done$/);
  const appId = await page.textContent(id("lblApplicationId"));
  expect(appId).toMatch(/^SSP-2026-\d{6}$/);

  const state = (await (await fetch(`${base}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
  expect(state.applications).toHaveLength(1);
  await ctx.close();
}, 30_000);

test("server-side validation shows legacy error text", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/apply/1`);
  await page.fill(id("txtMobile"), "12345");
  await page.click(id("btnNext1"));
  expect(await page.textContent(id("txtMobile_err"))).toContain("10 digits");
  expect(page.url()).toMatch(/\/apply\/1$/);
  await page.close();
});

test("mutation M1 relabels the income field", async () => {
  await fetch(`${base}/__lab/mutations`, { method: "POST", headers: { ...TOKEN, "content-type": "application/json" }, body: JSON.stringify({ enable: ["M1"], disable: [] }) });
  const html = await (await fetch(`${base}/apply/1`)).text();
  expect(html).toContain("Applicant Name");
  await fetch(`${base}/__lab/reset`, { method: "POST", headers: TOKEN });
});
