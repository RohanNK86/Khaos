import { readFile } from 'node:fs/promises';
import { ToolSchema, sensitiveParams, type Tool } from '@mcpify/contracts';
import { runTool, type FileBlob } from '@mcpify/engine';
import { installNetworkGuard } from '@mcpify/engine/network-guard';
import { createPlaywrightDriver } from '@mcpify/engine/playwright';
import { fromRoot, loadSites } from '@mcpify/recorder';
import { chromium } from 'playwright';
import type { ToolDraft, ValidationResult } from './types.js';

const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** Upload params are file names in the MCPify file store (fixtures/files for the demo). */
export async function loadFixtureFile(ref: string): Promise<FileBlob> {
  const name = ref.split(/[\\/]/).pop()!;
  return { name, mime: MIME[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', bytes: await readFile(fromRoot('fixtures/files', name)) };
}

/** A draft as a full Tool (placeholder id/timestamps) so the engine and ToolSchema accept it. */
export function draftToTool(draft: ToolDraft): Tool {
  const now = new Date().toISOString();
  const { examples: _e, warnings: _w, validation: _v, ...rest } = draft;
  return ToolSchema.parse({ ...rest, id: 'draft', siteId: draft.siteId ?? 'unknown', version: 1, createdAt: now, updatedAt: now });
}

/** Our own demo portals (owner mode in fixtures/sites.json) may receive draft saves; everything else gets the guard. */
async function needsGuard(draft: ToolDraft): Promise<boolean> {
  const origin = new URL(draft.startUrl).origin;
  const site = (await loadSites()).find(s => s.id === draft.siteId || s.origin === origin);
  return site?.mode !== 'owner';
}

/**
 * Validation run: execute the draft with the engine in DRY RUN (commit steps blocked, network guard on) using the
 * recorded example values. Passing means every step up to the first commit worked on the live site.
 * The network guard (abort every non-GET request) is on by default for sites that are not our owner-mode demo
 * portals; with it on, a run can only get as far as the first page change that posts a form.
 */
export async function validateDraft(
  draft: ToolDraft,
  opts: { headless?: boolean; inputs?: Record<string, unknown>; networkGuard?: boolean } = {},
): Promise<ValidationResult> {
  const tool = draftToTool(draft);
  const sensitive = sensitiveParams(tool);
  const inputs = Object.fromEntries(Object.entries(opts.inputs ?? draft.examples).filter(([k]) => !sensitive.has(k)));
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  try {
    const context = await browser.newContext();
    const blocked = (opts.networkGuard ?? (await needsGuard(draft))) ? await installNetworkGuard(context) : [];
    const run = await runTool(tool, inputs, createPlaywrightDriver(await context.newPage()), {
      onNeed: async () => ({}), // a dry run never answers: auth before the first commit stops the run
      loadFile: loadFixtureFile,
    }, { dryRun: true, mode: 'owner' });
    const failed = run.trace.find(t => t.status === 'failed');
    return {
      ok: run.status === 'dry_run_complete' || run.status === 'succeeded', status: run.status,
      passedSteps: run.trace.filter(t => t.status === 'passed').map(t => t.stepId),
      failedStepId: run.failedStepId, error: failed?.error, blockedRequests: blocked.length, at: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
