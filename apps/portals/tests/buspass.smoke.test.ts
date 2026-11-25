import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createBusPassPortal } from "../src/index.js";
import { FILES, lab, listen, otpOf, TOKEN } from "./helpers.js";

const PHOTO = fileURLToPath(new URL("sample-student-photo.png", FILES));
let server: Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  ({ server, base } = listen(createBusPassPortal()));
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(async () => { await fetch(`${base}/__lab/reset`, { method: "POST", headers: TOKEN }); });

async function toStep3(page: Page) {
  await page.goto(`${base}/renew/1`);
  await page.fill("#txtPassNo", "BPS-2025-004217");
  await page.fill("#txtDob", "2004-08-19");
  await page.click("#btnNext1");
  await page.waitForURL(/\/renew\/2$/);
  expect(await page.textContent("#lblName")).toBe("Meera Demo");
  await page.check("#chkConfirm");
  await page.click("#btnNext2");
  await page.waitForURL(/\/renew\/3$/);
}

test("every page shows the DEMO banner and lab hooks need the token", async () => {
  for (const p of ["/", "/renew/1", "/status"]) expect(await (await fetch(base + p)).text()).toContain('id="demoBanner"');
  expect((await fetch(`${base}/__lab/state`)).status).toBe(401);
});

test("renew pass: lookup → confirm → photo/route/dates → OTP → new pass number; status lookup", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await toStep3(page);
  await page.setInputFiles("#fuPhoto", PHOTO);
  await page.selectOption("#ddlRoute", { label: "Route 12: Railway Station - Demo Government College" });
  await page.fill("#txtFromDate", "2026-12-01");
  await page.fill("#txtToDate", "2027-05-31");
  await page.click("#btnNext3");
  await page.waitForURL(/\/renew\/4$/);

  await page.click("#btnSendOtp");
  await page.waitForSelector("#lblOtpMsg");
  await page.fill("#txtOtp", await otpOf(base, ctx));
  await page.click("#btnSubmit");
  await page.waitForURL(/\/renew\/done$/);
  const passNo = await page.textContent("#lblPassNo");
  expect(passNo).toMatch(/^BPS-2026-\d{6}$/);
  expect((await lab<{ renewals: unknown[] }>(base, "state")).renewals).toHaveLength(1);

  await page.goto(`${base}/status`);
  await page.fill("#txtStatusPassNo", passNo!);
  await page.click("#btnCheck");
  expect(await page.textContent("#lblPassStatus")).toContain("Issued: valid 2026-12-01 to 2027-05-31");
  await ctx.close();
}, 30_000);

test("step 3 validates the date range and the photo", async () => {
  const page = await browser.newPage();
  await toStep3(page);
  await page.selectOption("#ddlRoute", { index: 1 });
  await page.fill("#txtFromDate", "2026-12-01");
  await page.fill("#txtToDate", "2027-07-01");
  await page.setInputFiles("#fuPhoto", { name: "photo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await page.click("#btnNext3");
  expect(await page.textContent("#txtToDate_err")).toContain("at most 6 months");
  expect(await page.textContent("#fuPhoto_err")).toContain("JPG or PNG");
  await page.fill("#txtToDate", "2026-11-01");
  await page.setInputFiles("#fuPhoto", { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(600 * 1024) });
  await page.click("#btnNext3");
  expect(await page.textContent("#txtToDate_err")).toContain("after From date");
  expect(await page.textContent("#fuPhoto_err")).toContain("500 KB");
  expect(page.url()).toMatch(/\/renew\/3$/);
  await page.close();
}, 30_000);

test("unknown pass is rejected on step 1", async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/renew/1`);
  await page.fill("#txtPassNo", "BPS-2025-999999");
  await page.fill("#txtDob", "2004-08-19");
  await page.click("#btnNext1");
  expect(await page.textContent("#lblFind_err")).toContain("No pass found");
  await page.close();
});
