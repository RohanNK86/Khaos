import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { RecordingSchema } from '@mcpify/contracts';
import { LocalBlobStore, startRecording } from '../src/index.js';

const FORM = `<!doctype html><html><body><h2>Step 1 of 2 : Your details</h2>
<form method="post" action="/submit" id="f1"><table>
<tr><td>Full Name:</td><td><input id="name" name="name"></td></tr>
<tr><td><label for="city">City</label></td><td><select id="city" name="city"><option value="0">--Select--</option><option value="BLR">Bengaluru</option><option value="MYS">Mysuru</option></select></td></tr>
<tr><td>Password *</td><td><input id="pw" name="pw" type="password"></td></tr>
<tr><td>OTP</td><td><input id="otp" name="otp"></td></tr>
<tr><td>Proof</td><td><input id="proof" name="proof" type="file"></td></tr>
<tr><td colspan="2"><input type="checkbox" id="agree" name="agree"><label for="agree">I agree</label></td></tr>
</table><input type="submit" id="go" value="Send"></form></body></html>`;

let server: Server;
let base: string;
let browser: Browser;
let blobDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST') { req.resume(); req.on('end', () => { res.writeHead(303, { location: '/done' }); res.end(); }); return; }
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/done' ? '<p>Reference No: <b id="ref">REF-2026-0042</b></p>' : FORM);
  }).listen(0);
  await new Promise(r => server.once('listening', r));
  const a = server.address();
  base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
  browser = await chromium.launch();
  blobDir = await mkdtemp(join(tmpdir(), 'mcpify-blobs-'));
});
afterAll(async () => { await browser?.close(); server?.close(); await rm(blobDir, { recursive: true, force: true }); });

test('records a scripted session: labels, option labels, masking, noise collapsed, snapshots stored', async () => {
  const context = await browser.newContext();
  const blobs = new LocalBlobStore(blobDir);
  const session = await startRecording(context, { taskName: 'demo_task', startUrl: `${base}/form`, blobs });
  const page = session.page;
  await page.fill('#name', 'Asha');
  await page.fill('#name', 'Asha Demo');
  await page.click('label[for=city]');
  await page.selectOption('#city', 'MYS');
  await page.fill('#pw', 'secret-pass');
  await page.fill('#otp', '123456');
  await page.setInputFiles('#proof', { name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await page.click('label[for=agree]');
  await page.click('#go');
  await page.waitForURL(/\/done$/);
  const recording = await session.finish();
  await context.close();

  expect(RecordingSchema.parse(recording)).toBeTruthy();
  const json = JSON.stringify(recording);
  expect(json).not.toContain('secret-pass');
  expect(json).not.toContain('123456');
  const summary = recording.events.map(e => `${e.type}:${e.target?.id ?? e.url.replace(base, '')}=${e.value ?? ''}`);
  expect(summary).toEqual([
    'navigate:/form=', 'change:name=Asha Demo', 'change:city=Mysuru', 'change:pw=•••', 'change:otp=•••',
    'change:proof=proof.pdf', 'change:agree=true', 'click:go=', 'navigate:/done=',
  ]);
  const name = recording.events[1]!.target!;
  expect(name.label).toBe('Full Name');
  expect(recording.events[2]!.target!.label).toBe('City');
  expect(recording.events[2]!.target!.options).toContainEqual({ value: 'MYS', label: 'Mysuru' });
  expect(recording.events[7]!.target!.text).toBe('Send');
  expect(recording.events.map(e => e.seq)).toEqual(recording.events.map((_, i) => i));
  for (const e of [recording.events[0]!, recording.events.at(-1)!]) {
    expect(e.domSnapshotBlobId).toMatch(/^[a-f0-9]{64}$/);
    expect((await blobs.get(e.domSnapshotBlobId!))!.mime).toBe('text/html');
  }
  expect((await blobs.get(recording.events.at(-1)!.domSnapshotBlobId!))!.content.toString()).toContain('REF-2026-0042');
}, 60_000);

test('Ctrl+Shift+S in the page stops the recording', async () => {
  const context = await browser.newContext();
  const session = await startRecording(context, { taskName: 'stop_test', startUrl: `${base}/form`, blobs: false });
  await session.page.fill('#name', 'Asha');
  await session.page.keyboard.press('Control+Shift+S');
  await expect(Promise.race([session.stopped.then(() => 'stopped'), new Promise(r => setTimeout(() => r('timeout'), 5000))])).resolves.toBe('stopped');
  const recording = await session.finish();
  expect(recording.events.some(e => e.target?.id === 'name' && e.value === 'Asha')).toBe(true);
  await context.close();
}, 30_000);
