import type { Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type Browser } from "playwright";
import { createScholarshipPortal } from "../src/index.js";
import { lab, listen, TOKEN } from "./helpers.js";

let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  ({ server, base } = listen(createScholarshipPortal()));
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});

const id = (s: string) => `#ctl00_ContentPlaceHolder1_${s}`;

test("M6 is listed in the Layout Lab UI", async () => {
  const html = await (await fetch(`${base}/__lab`)).text();
  expect(html).toContain('data-m="M6"');
});

test("M6 splits page 2 into 2a (academic) and 2b (income, category, declaration)", async () => {
  await lab(base, "mutations", { method: "POST", body: JSON.stringify({ enable: ["M6"], disable: [] }) });
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

  expect(await page.locator(id("txtIncome")).count()).toBe(0);
  expect(await page.textContent("body")).toContain("Step 2a of 3");
  await page.selectOption(id("ddlCourse"), { label: "B.Sc" });
  await page.selectOption(id("ddlYear"), { label: "2nd Year" });
  await page.fill(id("txtInstitution"), "Demo Government College");
  await page.click(id("btnNext2a"));
  await page.waitForURL(/\/apply\/2b$/);

  expect(await page.locator(id("ddlCourse")).count()).toBe(0);
  await page.fill(id("txtIncome"), "180000");
  await page.selectOption(id("ddlCategory"), { label: "OBC" });
  await page.check(id("chkDeclare"));
  await page.click(id("btnNext2"));
  await page.waitForURL(/\/apply\/3$/);
  await ctx.close();
  await fetch(`${base}/__lab/reset`, { method: "POST", headers: TOKEN });
}, 30_000);

test("without M6, /apply/2b sends the user back to page 2", async () => {
  const res = await fetch(`${base}/apply/2b`, { redirect: "manual" });
  expect(res.status).toBe(303);
});
