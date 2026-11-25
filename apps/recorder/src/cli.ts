/**
 * pnpm --filter @mcpify/recorder record --site <slug> --task <task> [--url <url>] [--dry-run]
 * Opens a headed Chromium; do the task once; press Ctrl+Shift+S in the page or type `done` here to stop.
 */
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { LocalBlobStore } from './blobs.js';
import { publishRecording } from './api.js';
import { installDryRunGuard } from './guard.js';
import { saveRecording } from './save.js';
import { startRecording } from './session.js';
import { loadSites } from './sites.js';

const USAGE = 'Usage: record --site <slug> --task <snake_case_task> [--url <start url>] [--dry-run]';

interface CliArgs { site: string; task: string; url?: string; dryRun: boolean }

function parseArgs(args: string[]): CliArgs {
  const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const site = option('--site');
  const task = option('--task');
  if (args[0] !== 'record' || !site || !task) throw new Error(USAGE);
  if (!/^[a-z][a-z0-9_]*$/.test(task)) throw new Error('--task must be snake_case, e.g. apply_scholarship');
  return { site, task, url: option('--url'), dryRun: args.includes('--dry-run') };
}

/** Start URL: --url wins; else the site's origin (Portal 1 starts at its application form). */
async function startUrlFor(args: CliArgs): Promise<string> {
  const sites = await loadSites();
  const site = sites.find(s => s.slug === args.site);
  if (!site && !args.url) throw new Error(`unknown site "${args.site}" (known: ${sites.map(s => s.slug).join(', ') || 'none'}); pass --url`);
  if (args.url) {
    if (site && new URL(args.url).origin !== site.origin) console.warn(`[recorder] --url is not on ${site.origin} (site ${site.slug})`);
    return args.url;
  }
  return site!.slug === 'scholarship' ? `${site!.origin}/apply/1` : site!.origin;
}

function waitForDone(): { done: Promise<void>; close: () => void } {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const done = new Promise<void>(r => input.on('line', line => { if (line.trim().toLowerCase() === 'done') r(); }));
  return { done, close: () => input.close() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startUrl = await startUrlFor(args);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  if (args.dryRun) {
    await installDryRunGuard(context, (method, url) => console.log(`[recorder] dry run: blocked ${method} ${url}`));
    console.log('[recorder] DRY RUN: requests that send data are blocked.');
  }
  const blobs = new LocalBlobStore();
  const session = await startRecording(context, { taskName: args.task, startUrl, blobs });
  console.log('Do the task in the browser. Stop with Ctrl+Shift+S in the page, or type done and press Enter.');
  const terminal = waitForDone();
  await Promise.race([session.stopped, terminal.done, new Promise<void>(r => session.page.on('close', () => r()))]);
  terminal.close();
  const recording = await session.finish();
  await browser.close();
  const path = await saveRecording(recording);
  const masked = recording.events.filter(e => e.value === '•••').length;
  console.log(`Saved ${recording.events.length} events (${masked} masked) to ${path}`);
  const id = await publishRecording(recording, blobs);
  if (id) console.log(`Uploaded to the API as recording ${id}`);
  console.log(`Next: pnpm --filter @mcpify/compiler compile --recording ${path}`);
}

main().catch(error => { console.error((error as Error).message ?? error); process.exitCode = 1; });
