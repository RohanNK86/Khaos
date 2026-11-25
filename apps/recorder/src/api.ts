import type { Recording } from '@mcpify/contracts';
import type { BlobReader } from './blobs.js';

export const apiUrl = () => process.env.API_URL ?? 'http://localhost:4000';

/** POST JSON to the API; returns null (with a warning) when the API is not reachable. */
export async function postJson<T>(path: string, body: unknown, timeoutMs = 3000): Promise<T | null> {
  try {
    const res = await fetch(`${apiUrl()}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.warn(`[mcpify] POST ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`[mcpify] API at ${apiUrl()} not reachable (${(e as Error).message}); skipped POST ${path}`);
    return null;
  }
}

async function postBlob(content: Buffer, mime: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl()}/blobs`, { method: 'POST', headers: { 'content-type': mime }, body: new Uint8Array(content), signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Upload the recording's DOM snapshots (POST /blobs) and the recording itself (POST /recordings). */
export async function publishRecording(recording: Recording, blobs: BlobReader): Promise<string | null> {
  const health = await fetch(`${apiUrl()}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
  if (!health) {
    console.warn(`[mcpify] API at ${apiUrl()} is not up; the recording stays local only.`);
    return null;
  }
  const ids = new Set(recording.events.map(e => e.domSnapshotBlobId).filter((id): id is string => Boolean(id)));
  for (const id of ids) {
    const blob = await blobs.get(id);
    if (blob && !(await postBlob(blob.content, blob.mime))) console.warn(`[mcpify] could not upload snapshot ${id}`);
  }
  const res = await postJson<{ id: string }>('/recordings', recording);
  return res?.id ?? null;
}
