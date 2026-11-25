import { readFile } from 'node:fs/promises';
import { RecordingSchema, type Recording } from '@mcpify/contracts';

/** Saved Portal 1 recording + its DOM snapshots (regenerate: UPDATE_FIXTURES=1 pnpm --filter @mcpify/compiler exec vitest run tests/e2e.test.ts). */
export async function portal1Fixture(): Promise<{ recording: Recording; loadSnapshot: (id: string) => Promise<string | null> }> {
  const dir = new URL('./fixtures/', import.meta.url);
  const recording = RecordingSchema.parse(JSON.parse(await readFile(new URL('portal1.recording.json', dir), 'utf8')));
  const snapshots = JSON.parse(await readFile(new URL('portal1.snapshots.json', dir), 'utf8')) as Record<string, string>;
  return { recording, loadSnapshot: async id => snapshots[id] ?? null };
}
