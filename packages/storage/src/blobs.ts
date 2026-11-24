import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface BlobStore {
  put(content: string | Uint8Array, mime: string): Promise<string>;
  get(blobId: string): Promise<{ content: Buffer; mime: string } | null>;
}

/** Content-addressed blobs on local disk (sha256 ids). S3 implementation comes after the demo. */
export class FsBlobStore implements BlobStore {
  constructor(private dir = process.env.BLOB_DIR ?? ".data/blobs") {}

  async put(content: string | Uint8Array, mime: string): Promise<string> {
    const buf = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    const id = createHash("sha256").update(buf).digest("hex");
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, id), buf);
    await writeFile(join(this.dir, `${id}.mime`), mime);
    return id;
  }

  async get(blobId: string) {
    if (!/^[a-f0-9]{64}$/.test(blobId)) return null;
    try {
      const content = await readFile(join(this.dir, blobId));
      const mime = await readFile(join(this.dir, `${blobId}.mime`), "utf8").catch(() => "application/octet-stream");
      return { content, mime };
    } catch {
      return null;
    }
  }
}
