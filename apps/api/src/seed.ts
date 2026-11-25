import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SiteSchema, ToolSchema, type Site, type Tool } from "@mcpify/contracts";
import { openDb } from "./db/client.js";
import { loadEnv, p } from "./paths.js";
import { Store } from "./store.js";

export interface Fixtures {
  sites: Site[];
  tools: Tool[];
}

/** Read fixtures/sites.json and fixtures/tools/*.json. `rewrite` may edit the raw text (tests retarget ports). */
export function loadFixtures(rewrite: (raw: string) => string = (s) => s, root = p("fixtures")): Fixtures {
  const sitesFile = join(root, "sites.json");
  const sites = existsSync(sitesFile) ? (JSON.parse(rewrite(readFileSync(sitesFile, "utf8"))) as unknown[]).map((s) => SiteSchema.parse(s)) : [];
  const toolDir = join(root, "tools");
  const tools: Tool[] = [];
  for (const f of existsSync(toolDir) ? readdirSync(toolDir).filter((x) => x.endsWith(".json")) : []) {
    const parsed = ToolSchema.safeParse(JSON.parse(rewrite(readFileSync(join(toolDir, f), "utf8"))));
    if (parsed.success) tools.push(parsed.data);
    else console.error(`[seed] skipping invalid tool ${f}: ${parsed.error.issues[0]?.message}`);
  }
  return { sites, tools };
}

/** Idempotent: upsert sites by id and tool versions by (id, version); stored tool statuses are kept. */
export async function seed(store: Store, fx: Fixtures): Promise<{ sites: number; tools: number }> {
  for (const site of fx.sites) await store.putSite(site);
  const known = new Set((await store.listSites()).map((s) => s.id));
  let tools = 0;
  for (const tool of fx.tools) {
    if (!known.has(tool.siteId)) {
      console.error(`[seed] skipping ${tool.name}: unknown site ${tool.siteId}`);
      continue;
    }
    await store.upsertToolVersion(tool);
    tools++;
  }
  return { sites: fx.sites.length, tools };
}

/** Startup: seed only when there are no tools at all. */
export async function seedIfEmpty(store: Store, fx: () => Fixtures = () => loadFixtures()): Promise<boolean> {
  if ((await store.countTools()) > 0) return false;
  const r = await seed(store, fx());
  console.log(`[api] empty database: seeded ${r.sites} site(s) and ${r.tools} tool(s) from fixtures/`);
  return true;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadEnv();
  const { db, close } = await openDb();
  const r = await seed(new Store(db), loadFixtures());
  console.log(`[seed] upserted ${r.sites} site(s) and ${r.tools} tool(s)`);
  await close();
}
