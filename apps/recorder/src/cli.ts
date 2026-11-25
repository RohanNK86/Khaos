import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { RecordedEventSchema, RecordingSchema, type RecordedEvent } from '@mcpify/contracts';
import { installCapture } from './capture.js';

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args[0] !== 'record' || option('--site') !== 'scholarship' || !option('--task')) {
    throw new Error('Usage: record --site scholarship --task <task> [--url <url>]');
  }
  const taskName = option('--task')!;
  if (!/^[a-z][a-z0-9_]*$/.test(taskName)) throw new Error('Task must be snake_case');
  const startUrl = option('--url') ?? 'http://localhost:5101/apply/1';
  const started = Date.now();
  const events: RecordedEvent[] = [];
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  await context.exposeBinding('__mcpifyRecord', (_source, raw: unknown) => {
    const data = raw as Record<string, unknown>;
    const event = RecordedEventSchema.parse({ ...data, seq: events.length, t: Date.now() - started });
    const previous = events.at(-1);
    if (event.type === 'input' && previous?.type === 'input' && previous.target?.cssPath === event.target?.cssPath && previous.url === event.url) {
      event.seq = previous.seq;
      events[events.length - 1] = event;
    } else events.push(event);
  });
  await context.addInitScript(installCapture);
  const page = await context.newPage();
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) events.push({ seq: events.length, t: Date.now() - started, type: 'navigate', url: frame.url() });
  });
  await page.goto(startUrl);
  console.log('Complete the task in the browser, then type done and press Enter.');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>(resolveDone => {
    input.on('line', line => { if (line.trim().toLowerCase() === 'done') resolveDone(); });
    page.on('close', () => resolveDone());
  });
  input.close();
  await browser.close();
  const recording = RecordingSchema.parse({ id: randomUUID(), siteOrigin: new URL(startUrl).origin, startUrl, taskName, events, createdAt: new Date().toISOString() });
  const dir = resolve('recordings');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${taskName}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(recording, null, 2));
  console.log(`Saved ${events.length} events to ${path}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

