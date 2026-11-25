import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fromRoot, postJson, siteByOrigin } from '@mcpify/recorder';
import type { ToolDraft } from './types.js';

/** `.data/tools/drafts/<site>.<name>.json` (site slug from fixtures/sites.json, else the host name). */
export async function draftPath(draft: ToolDraft): Promise<string> {
  const origin = new URL(draft.startUrl).origin;
  const slug = (await siteByOrigin(origin))?.slug ?? new URL(origin).host.replace(/[^a-z0-9]+/gi, '-');
  return fromRoot('.data/tools/drafts', `${slug}.${draft.name}.json`);
}

export async function saveDraft(draft: ToolDraft, path?: string): Promise<string> {
  const out = path ?? (await draftPath(draft));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(draft, null, 2) + '\n');
  return out;
}

/** POST /tools (status draft, version 1) when the API is up and the site is known. */
export async function publishDraft(draft: ToolDraft): Promise<{ id: string } | null> {
  if (!draft.siteId) {
    console.warn('[compiler] draft has no siteId (site not in fixtures/sites.json); not posted to the API');
    return null;
  }
  const { examples: _e, warnings: _w, validation: _v, status: _s, ...body } = draft;
  return postJson<{ id: string }>('/tools', body);
}
