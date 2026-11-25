import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsBlobStore, LocalEd25519Signer } from "@mcpify/storage";
import { createApi, type Api } from "../src/app.js";
import { dropDatabase, recreateDatabase } from "../src/db/client.js";
import { loadFixtures } from "../src/seed.js";

process.env.LLM_DISABLED = "1";

/** A fresh API on a scratch database (dropped and recreated per run). */
export async function setupApi(dbName: string): Promise<Api & { dir: string; teardown(): Promise<void> }> {
  const databaseUrl = await recreateDatabase(dbName);
  const dir = mkdtempSync(join(tmpdir(), "mcpify-api-"));
  const api = await createApi({
    databaseUrl,
    headless: true,
    blobs: new FsBlobStore(join(dir, "blobs")),
    signer: new LocalEd25519Signer(join(dir, "keys")),
    fixtures: () => loadFixtures(),
    mcpifyJsPath: join(dir, "mcpify.js"),
  });
  return {
    ...api,
    dir,
    async teardown() {
      await api.close();
      await dropDatabase(dbName);
    },
  };
}

export const GOLDEN_APPLY = "5c1a0b6e-0000-4000-8000-000000000001";
export const GOLDEN_STATUS = "5c1a0b6e-0000-4000-8000-000000000002";
