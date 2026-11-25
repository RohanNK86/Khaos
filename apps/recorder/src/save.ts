import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Recording } from '@mcpify/contracts';
import { fromRoot } from './paths.js';

/** Write `recordings/<task>-<timestamp>.json` (git-ignored) and return its path. */
export async function saveRecording(recording: Recording, dir = fromRoot('recordings')): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${recording.taskName}-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(recording, null, 2) + '\n');
  return path;
}
