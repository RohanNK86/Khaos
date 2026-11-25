import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { RecordingSchema, type Recording } from '@mcpify/contracts';
import { runTool } from '@mcpify/engine';
import { createPlaywrightDriver } from '@mcpify/engine/playwright';
import { LocalBlobStore } from '@mcpify/recorder';
import { SnapshotDom, compile, draftToTool, planSteps, validateDraft, type ToolDraft } from '../src/index.js';
import { TOKEN, golden, labHooks, recordPortal1, retarget, shape, startPortal } from './helpers.js';

let portal: { server: Server; base: string };
let browser: Browser;
let blobDir: string;
let blobs: LocalBlobStore;
let recording: Recording;
let draft: ToolDraft;
const load = async (id: string) => (await blobs.get(id))?.content.toString('utf8') ?? null;

beforeAll(async () => {
  process.env.LLM_DISABLED = '1';
  portal = await startPortal();
  browser = await chromium.launch();
  blobDir = await mkdtemp(join(tmpdir(), 'mcpify-compiler-'));
  blobs = new LocalBlobStore(blobDir);
}, 30_000);
afterAll(async () => {
  await browser?.close();
  portal?.server.close();
  await rm(blobDir, { recursive: true, force: true });
});

test('(a) records a full Portal 1 application with the programmatic recorder', async () => {
  recording = await recordPortal1(browser, portal.base, blobs);
  expect(RecordingSchema.parse(recording)).toBeTruthy();
  const masked = recording.events.filter(e => e.value === '•••');
  expect(masked.map(e => e.target?.id)).toEqual(['ctl00_ContentPlaceHolder1_txtOTP', 'ctl00_ContentPlaceHolder1_txtCaptcha']);
  if (process.env.UPDATE_FIXTURES === '1') {
    const snapshots: Record<string, string> = {};
    for (const e of recording.events) if (e.domSnapshotBlobId) snapshots[e.domSnapshotBlobId] = (await load(e.domSnapshotBlobId))!;
    const dir = new URL('./fixtures/', import.meta.url);
    await writeFile(new URL('portal1.recording.json', dir), JSON.stringify(recording, null, 2) + '\n');
    await writeFile(new URL('portal1.snapshots.json', dir), JSON.stringify(snapshots) + '\n');
  }
}, 60_000);

test('(b, c) compiles rules-only to the golden step sequence, risk classes and outputs', async () => {
  draft = await compile(recording, { loadSnapshot: load, llm: false, siteId: 'site-scholarship' });
  const g = await golden();
  expect(shape(draft.steps)).toEqual(shape(g.steps));
  expect(draft.steps.map(s => s.id)).toEqual([
    'open_start_page', 'enter_applicant_name', 'enter_date_of_birth', 'select_gender', 'enter_mobile', 'enter_email',
    'continue_to_academic_and_income_details', 'select_course', 'select_year_of_study', 'enter_institution_name',
    'enter_annual_family_income', 'select_category', 'accept_declaration', 'continue_to_documents_and_verification',
    'send_otp', 'enter_otp', 'upload_income_certificate', 'enter_captcha', 'submit_application', 'read_application_id',
  ]);
  expect(draft.outputs).toEqual(['application_id']);
  expect(draft.steps.at(-1)!.post[0]).toMatchObject({ kind: 'extract', as: 'application_id', pattern: 'SSP-\\d{4}-\\d{6}' });
  expect(draft.steps.find(s => s.id === 'send_otp')!.post[0]).toMatchObject({ kind: 'textPresent', text: expect.stringMatching(/OTP has been sent/) });
  expect(draft.steps.find(s => s.id === 'submit_application')!.post[0]).toEqual({ kind: 'urlMatches', pattern: '\\/apply\\/done$' });
  for (const s of draft.steps.filter(x => x.action.type !== 'navigate')) expect(s.locators.length, s.id).toBeGreaterThanOrEqual(2);
  for (const s of draft.steps.filter(x => x.risk === 'commit' || x.risk === 'auth')) expect(s.repair).toBe('human');
  const props = draft.inputSchema.properties as Record<string, Record<string, unknown>>;
  expect(props.gender).toMatchObject({ type: 'string', enum: ['Male', 'Female', 'Other'], title: 'Gender' });
  expect(props.date_of_birth).toMatchObject({ format: 'date' });
  expect(props.annual_family_income).toMatchObject({ type: 'integer' });
  expect(props.declaration).toMatchObject({ type: 'boolean' });
  expect(props.income_certificate).toMatchObject({ default: 'sample-income-certificate.pdf' });
  expect(props.otp).toBeUndefined();
  expect(draft.examples).not.toHaveProperty('otp');
  expect(draft.warnings).toEqual([]);
  expect(() => draftToTool(draft)).not.toThrow();
}, 60_000);

test('(c) every locator resolves to exactly one visible element in its step snapshot', async () => {
  const planned = planSteps(recording.events, []);
  const dom = await SnapshotDom.open(load);
  try {
    for (const [i, step] of draft.steps.entries()) {
      if (step.locators.length === 0) continue;
      const shot = step.action.type === 'extract' ? planned.at(-1)!.after!.snapshotId : planned[i]!.snapshotId;
      const r = await dom.verify(shot, step.locators);
      expect(r?.ok, step.id).toEqual(step.locators.map(() => true));
    }
  } finally {
    await dom.close();
  }
}, 60_000);

test('(d) the compiled tool runs end to end with the engine on a fresh Portal 1', async () => {
  const fresh = await startPortal();
  try {
    const tool = retarget(draftToTool(draft), portal.base, fresh.base);
    const ctx = await browser.newContext();
    const hooks = labHooks(ctx, fresh.base);
    const run = await runTool(tool, draft.examples, createPlaywrightDriver(await ctx.newPage()), hooks, { dryRun: false, mode: 'owner' });
    expect(run.trace.find(t => t.status === 'failed')?.error).toBeUndefined();
    expect(run.status).toBe('succeeded');
    expect(run.outputs.application_id).toMatch(/^SSP-2026-\d{6}$/);
    expect(hooks.asked).toEqual(['confirm:send_otp', 'input:otp', 'input:captcha', 'confirm:submit_application']);
    const state = (await (await fetch(`${fresh.base}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
    expect(state.applications).toHaveLength(1);
    await ctx.close();
  } finally {
    fresh.server.close();
  }
}, 90_000);

test('validation run: dry run passes every step up to Send OTP and sends nothing', async () => {
  const result = await validateDraft(draft);
  expect(result).toMatchObject({ ok: true, status: 'dry_run_complete' });
  expect(result.passedSteps).toContain('continue_to_documents_and_verification');
  expect(result.passedSteps).not.toContain('send_otp');
  const state = (await (await fetch(`${portal.base}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
  expect(state.applications).toHaveLength(1); // only the one from the recording
}, 60_000);
