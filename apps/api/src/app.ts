import { join } from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { FsBlobStore, LocalEd25519Signer, type BlobStore, type Signer } from "@mcpify/storage";
import type { Ctx } from "./context.js";
import { openDb } from "./db/client.js";
import { installErrorHandling } from "./http.js";
import { DATA, p } from "./paths.js";
import { agentRoutes } from "./routes/agent.js";
import { blobRoutes } from "./routes/blobs.js";
import { receiptRoutes } from "./routes/receipts.js";
import { registryRoutes } from "./routes/registry.js";
import { repairRoutes } from "./routes/repairs.js";
import { runRoutes } from "./routes/runs.js";
import { staticRoutes } from "./routes/static.js";
import { RunManager } from "./runs/run-manager.js";
import { seedIfEmpty, type Fixtures } from "./seed.js";
import { Store } from "./store.js";

export interface ApiOptions {
  databaseUrl?: string;
  blobs?: BlobStore;
  signer?: Signer;
  /** Chromium without a window (default: env HEADLESS=1). */
  headless?: boolean;
  showActions?: boolean;
  logger?: boolean;
  /** Fixtures used when the tools table is empty (default: fixtures/). */
  fixtures?: () => Fixtures;
  mcpifyJsPath?: string;
}

export interface Api {
  app: FastifyInstance;
  ctx: Ctx;
  close(): Promise<void>;
}

/** Build the HTTP API on an existing context (tests can pass their own). */
export async function buildApp(ctx: Ctx, opts: Pick<ApiOptions, "logger" | "mcpifyJsPath"> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  await app.register(cors, { origin: "*" });
  installErrorHandling(app);
  registryRoutes(app, ctx);
  runRoutes(app, ctx);
  receiptRoutes(app, ctx);
  repairRoutes(app, ctx);
  await blobRoutes(app, ctx);
  agentRoutes(app);
  staticRoutes(app, opts.mcpifyJsPath);
  return app;
}

/** Connect to Postgres, migrate, seed if empty, and build the app. */
export async function createApi(opts: ApiOptions = {}): Promise<Api> {
  const handle = await openDb(opts.databaseUrl);
  const store = new Store(handle.db);
  await seedIfEmpty(store, opts.fixtures);
  const blobs = opts.blobs ?? new FsBlobStore(process.env.BLOB_DIR ? p(process.env.BLOB_DIR) : join(DATA, "blobs"));
  const signer = opts.signer ?? new LocalEd25519Signer(process.env.KEY_DIR ? p(process.env.KEY_DIR) : join(DATA, "keys"));
  const headless = opts.headless ?? process.env.HEADLESS === "1";
  const runs = new RunManager({ store, blobs, signer, headless, showActions: opts.showActions });
  const ctx: Ctx = { store, blobs, signer, runs };
  const app = await buildApp(ctx, opts);
  return {
    app,
    ctx,
    async close() {
      await app.close();
      await runs.close();
      await handle.close();
    },
  };
}
