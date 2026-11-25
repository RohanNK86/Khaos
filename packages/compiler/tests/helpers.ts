import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { Browser, BrowserContext } from 'playwright';
import { ToolSchema, type Recording, type Tool } from '@mcpify/contracts';
import type { RunHooks } from '@mcpify/engine';
import { createScholarshipPortal } from '@mcpify/portals';
import { startRecording, type BlobWriter } from '@mcpify/recorder';
import { loadFixtureFile, type ToolDraft } from '../src/index.js';

export const ROOT = new URL('../../../', import.meta.url);
export const TOKEN = { 'x-lab-token': 'changeme' };
export const CERT = new URL('fixtures/files/sample-income-certificate.pdf', ROOT).pathname;

export async function startPortal(): Promise<{ server: Server; base: string }> {
  const server = createScholarshipPortal().listen(0);
  await new Promise(r => server.once('listening', r));
  const a = server.address();
  return { server, base: `http://localhost:${typeof a === 'object' && a ? a.port : 0}` };
}

export async function golden(): Promise<Tool> {
  return ToolSchema.parse(JSON.parse(await readFile(new URL('fixtures/tools/scholarship.apply_scholarship.v1.json', ROOT), 'utf8')));
}

async function lab(ctx: BrowserContext, base: string, what: 'otp' | 'captcha'): Promise<string> {
  const sid = (await ctx.cookies()).find(c => c.name === 'ASP.NET_SessionId')!.value;
  const res = await fetch(`${base}/__lab/${what}?session=${sid}`, { headers: TOKEN });
  return ((await res.json()) as Record<string, string>)[what]!;
}

/** Scripted, fictional Portal 1 application recorded with the programmatic recorder. */
export async function recordPortal1(browser: Browser, base: string, blobs: BlobWriter): Promise<Recording> {
  const context = await browser.newContext();
  const session = await startRecording(context, { taskName: 'apply_scholarship', startUrl: `${base}/apply/1`, blobs });
  const page = session.page;
  const id = (s: string) => `#ctl00_ContentPlaceHolder1_${s}`;
  await page.fill(id('txtApplicantName'), 'Asha Demo');
  await page.fill(id('txtDOB'), '2005-04-12');
  await page.selectOption(id('ddlGender'), { label: 'Female' });
  await page.fill(id('txtMobile'), '9876543210');
  await page.fill(id('txtEmail'), 'asha.demo@example.com');
  await page.click(id('btnNext1'));
  await page.waitForURL(/\/apply\/2$/);
  await page.selectOption(id('ddlCourse'), { label: 'B.Sc' });
  await page.selectOption(id('ddlYear'), { label: '2nd Year' });
  await page.fill(id('txtInstitution'), 'Demo Government College');
  await page.fill(id('txtIncome'), '180000');
  await page.selectOption(id('ddlCategory'), { label: 'OBC' });
  await page.check(id('chkDeclare'));
  await page.click(id('btnNext2'));
  await page.waitForURL(/\/apply\/3$/);
  await page.click(id('btnSendOtp'));
  await page.waitForSelector(id('lblOtpMsg'));
  await page.fill(id('txtOTP'), await lab(context, base, 'otp'));
  await page.setInputFiles(id('fuIncomeCert'), CERT);
  await page.fill(id('txtCaptcha'), await lab(context, base, 'captcha'));
  await page.click(id('btnSubmit'));
  await page.waitForURL(/\/apply\/done$/);
  await page.waitForLoadState('load');
  const recording = await session.finish();
  await context.close();
  return recording;
}

/** Engine hooks: confirmations auto-approved, OTP/CAPTCHA read from the portal's lab hooks (tests only). */
export function labHooks(ctx: BrowserContext, base: string): RunHooks & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async onNeed(n) {
      asked.push(n.kind === 'confirmation' ? `confirm:${n.stepId}` : `input:${n.param}`);
      if (n.kind === 'confirmation') return { approve: true };
      return { value: await lab(ctx, base, n.param === 'otp' ? 'otp' : 'captcha') };
    },
    loadFile: loadFixtureFile,
  };
}

export const retarget = <T extends Tool | ToolDraft>(t: T, from: string, to: string): T => JSON.parse(JSON.stringify(t).replaceAll(from, to)) as T;
export const shape = (steps: Tool['steps']) => steps.map(s => `${s.action.type}:${s.risk}`);
