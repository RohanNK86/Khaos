/**
 * Approve a compiled draft tool so the MCP server lists it.
 *   pnpm --filter @mcpify/mcp-server approve <draft.json> [--site scholarship]
 * Fills missing id/version/timestamps, sets status "approved", validates with ToolSchema,
 * writes .data/tools/approved/<site>.<name>.json (newer than the golden tool, so it wins).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ToolSchema, mcpToolName } from "@mcpify/contracts";
import { DATA } from "./paths.js";
import { Registry } from "./registry.js";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: approve <draft.json> [--site <slug>]");
  process.exit(1);
}
const slug = rest[rest.indexOf("--site") + 1] && rest.includes("--site") ? rest[rest.indexOf("--site") + 1]! : undefined;
const draft = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), "utf8")) as Record<string, unknown>;
const sites = new Registry().sites();
const site = sites.find((s) => (slug ? s.slug === slug : s.id === draft.siteId || (typeof draft.startUrl === "string" && draft.startUrl.startsWith(s.origin))));
if (!site) {
  console.error(`no site found (known: ${sites.map((s) => s.slug).join(", ")}); pass --site <slug>`);
  process.exit(1);
}
const now = new Date().toISOString();
const out = join(DATA, "tools/approved", `${site.slug}.${String(draft.name)}.json`);
const prevVersion = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as { version: number }).version : 0;
const tool = ToolSchema.parse({
  outputs: [],
  ...draft,
  id: (draft.id as string | undefined) ?? crypto.randomUUID(),
  siteId: site.id,
  version: Math.max(prevVersion + 1, Number(draft.version ?? 1)),
  status: "approved",
  createdAt: (draft.createdAt as string | undefined) ?? now,
  updatedAt: now,
});
mkdirSync(join(DATA, "tools/approved"), { recursive: true });
writeFileSync(out, JSON.stringify(tool, null, 2) + "\n");
console.log(`approved ${mcpToolName(site, tool)} v${tool.version} (${tool.steps.length} steps) -> ${out}`);
console.log("The MCP server picks it up on the next tools/list (reconnect the client to refresh).");
