/**
 * pnpm --filter @mcpify/compiler compile --recording <file|id> [--out <file>] [--validate] [--site-id <id>] [--no-llm]
 * Writes the draft to .data/tools/drafts/<site>.<name>.json (and --out), and POSTs /tools when the API is up.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { RecordingSchema, type Recording } from '@mcpify/contracts';
import { apiUrl, fromRoot, fromUser } from '@mcpify/recorder';
import { compile } from './compile.js';
import { draftHash, publishDraft, saveDraft } from './save.js';
import { validateDraft } from './validate.js';

const USAGE = 'Usage: compile --recording <file|id> [--out <file>] [--validate] [--site-id <id>] [--no-llm]';

/** A file path, a recording id in recordings/, or a recording id on the API. */
async function loadRecording(ref: string): Promise<Recording> {
  const path = fromUser(ref);
  if (existsSync(path)) return RecordingSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  const dir = fromRoot('recordings');
  for (const f of existsSync(dir) ? await readdir(dir) : []) {
    if (!f.endsWith('.json')) continue;
    const json = JSON.parse(await readFile(`${dir}/${f}`, 'utf8')) as { id?: string };
    if (json.id === ref) return RecordingSchema.parse(json);
  }
  const res = await fetch(`${apiUrl()}/recordings/${encodeURIComponent(ref)}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (res?.ok) return RecordingSchema.parse(await res.json());
  throw new Error(`recording "${ref}" not found (not a file, not in recordings/, not on the API)`);
}

async function main() {
  try { process.loadEnvFile(fromRoot('.env')); } catch { /* no .env: defaults */ }
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const ref = option('--recording');
  if (!ref) throw new Error(USAGE);
  const recording = await loadRecording(ref);
  const draft = await compile(recording, { llm: !args.includes('--no-llm'), siteId: option('--site-id') });
  for (const w of draft.warnings) console.warn(`[compiler] warning: ${w}`);
  if (args.includes('--validate')) {
    draft.validation = await validateDraft(draft);
    const v = draft.validation;
    console.log(`[compiler] validation (dry run): ${v.status}, ${v.passedSteps.length} steps passed${v.error ? `, failed at ${v.failedStepId}: ${v.error}` : ''}`);
  }
  const path = await saveDraft(draft);
  const out = option('--out');
  if (out) await saveDraft(draft, fromUser(out));
  console.log(`[compiler] ${draft.steps.length} steps, risks: ${draft.steps.map(s => s.risk).join(' ')}`);
  console.log(`[compiler] draft written to ${path}${out ? ` and ${fromUser(out)}` : ''}`);
  const posted = await publishDraft(draft);
  if (posted) {
    // remember which API tool this file is, so `approve <file>` approves it instead of creating a copy
    await saveDraft({ ...draft, apiToolId: posted.id, apiToolHash: draftHash(draft) }, path);
    console.log(`[compiler] posted to the API as tool ${posted.id}`);
  }
  console.log(`Next: pnpm --filter @mcpify/mcp-server approve ${path}`);
}

main().catch(e => { console.error((e as Error).message); process.exitCode = 1; });
