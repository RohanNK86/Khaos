import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromRoot } from './paths.js';

export interface BlobWriter {
  put(content: string | Uint8Array, mime: string): Promise<string>;
}
export interface BlobReader {
  get(blobId: string): Promise<{ content: Buffer; mime: string } | null>;
}

/**
 * Content-addressed blobs on local disk, same layout as `@mcpify/storage` FsBlobStore
 * (`<dir>/<sha256>` + `<sha256>.mime`), so either can read what the other wrote.
 * Kept local because the recorder does not depend on @mcpify/storage yet.
 */
export class LocalBlobStore implements BlobWriter, BlobReader {
  readonly dir: string;
  constructor(dir = process.env.BLOB_DIR ? fromRoot(process.env.BLOB_DIR) : fromRoot('.data/blobs')) {
    this.dir = dir;
  }

  async put(content: string | Uint8Array, mime: string): Promise<string> {
    const buf = Buffer.from(content);
    const id = createHash('sha256').update(buf).digest('hex');
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, id), buf);
    await writeFile(join(this.dir, `${id}.mime`), mime);
    return id;
  }

  async get(blobId: string) {
    if (!/^[a-f0-9]{64}$/.test(blobId)) return null;
    try {
      const content = await readFile(join(this.dir, blobId));
      const mime = await readFile(join(this.dir, `${blobId}.mime`), 'utf8').catch(() => 'application/octet-stream');
      return { content, mime };
    } catch {
      return null;
    }
  }
}
