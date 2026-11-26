/**
 * pnpm demo:reset — put the demo back to its starting state before a rehearsal or the real demo:
 *  - every golden tool (fixtures/tools) back to v1, approved (repaired versions removed),
 *  - other approved tools with the same site + name disabled (the golden one is what the demo shows),
 *  - repair proposals for those tools removed,
 *  - the demo portals reset (applications, OTPs, Layout Lab mutations).
 * Runs, receipts, recordings and the audit log are kept.
 */
import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { openDb } from "./db/client.js";
import { repairs, tools } from "./db/schema.js";
import { loadEnv } from "./paths.js";
import { loadFixtures, seed } from "./seed.js";
import { Store } from "./store.js";

loadEnv();
const handle = await openDb();
const store = new Store(handle.db);
const fx = loadFixtures();
const ids = fx.tools.map((t) => t.id);

const removed = await handle.db.delete(tools).where(and(inArray(tools.id, ids), gt(tools.version, 1))).returning({ id: tools.id, version: tools.version });
await seed(store, fx);
for (const t of fx.tools) {
  const v1 = await store.latestTool(t.id);
  if (v1 && v1.status !== "approved") await store.setToolStatus(v1, "approved");
  const rivals = await handle.db.select().from(tools).where(and(eq(tools.siteId, t.siteId), eq(tools.name, t.name), ne(tools.id, t.id), eq(tools.status, "approved")));
  for (const r of rivals) await store.setToolStatus(r.json, "disabled");
}
const gone = await handle.db.delete(repairs).where(inArray(repairs.toolId, ids)).returning({ id: repairs.id });
await handle.close();

const token = process.env.LAB_TOKEN ?? "changeme";
const portals: string[] = [];
for (const site of fx.sites) {
  const ok = await fetch(`${site.origin}/__lab/reset`, { method: "POST", headers: { "x-lab-token": token }, signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  portals.push(`${site.slug}: ${ok ? "reset" : "not running"}`);
}
console.log(`[demo:reset] removed ${removed.length} repaired tool version(s) and ${gone.length} repair proposal(s); ${fx.tools.length} golden tools at v1, approved`);
console.log(`[demo:reset] portals: ${portals.join(", ")}`);
console.log("[demo:reset] start a NEW Claude Code chat so it re-reads the tools.");
