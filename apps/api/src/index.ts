import { createApi } from "./app.js";
import { loadEnv } from "./paths.js";

export { buildApp, createApi, type Api, type ApiOptions } from "./app.js";
export { openDb, recreateDatabase, dropDatabase } from "./db/client.js";
export { Store } from "./store.js";
export { loadFixtures, seed, seedIfEmpty } from "./seed.js";
export { RunManager } from "./runs/run-manager.js";
export { setRepairHandler, onStepFailed, type RepairHandler, type StepFailureEvidence } from "./runs/repair-hook.js";
export { decideRepairStatus } from "./routes/repairs.js";

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadEnv();
  const port = Number(process.env.API_PORT ?? 4000);
  const api = await createApi({ logger: process.env.API_LOG === "1" });
  await api.app.listen({ port, host: "0.0.0.0" });
  console.log(`[api] MCPify API: http://localhost:${port} (runs ${process.env.HEADLESS === "1" ? "headless" : "in a visible Chromium"})`);
  const shutdown = () => void api.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
