/**
 * Approve a compiled draft tool through the MCPify API so the MCP server lists it.
 *   pnpm --filter @mcpify/mcp-server approve <draft.json> [--site scholarship]   (POST /tools, then approve)
 *   pnpm --filter @mcpify/mcp-server approve --id <toolId>                         (approve a draft already in the API)
 * The API disables any other approved tool with the same site + name, so the new one replaces it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mcpToolName } from "@mcpify/contracts";
import { ApiClient } from "./api-client.js";
import { p } from "./paths.js";

try {
  process.loadEnvFile(p(".env"));
} catch {
  // .env is optional
}

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const api = new ApiClient();

async function main(): Promise<void> {
  const id = flag("--id");
  const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!id && !file) throw new Error("usage: approve <draft.json> [--site <slug>] | approve --id <toolId>");
  const sites = await api.sites();
  let toolId = id;
  if (!toolId) {
    const draft = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file!), "utf8")) as Record<string, unknown>;
    const slug = flag("--site");
    const site = sites.find((s) => (slug ? s.slug === slug : s.id === draft.siteId || (typeof draft.startUrl === "string" && draft.startUrl.startsWith(s.origin))));
    if (!site) throw new Error(`no site found (known: ${sites.map((s) => s.slug).join(", ")}); pass --site <slug>`);
    const { apiToolId, apiToolHash, ...body } = draft;
    const unchanged = typeof apiToolId === "string" && apiToolHash === draftHash(draft);
    toolId = unchanged ? apiToolId : (await api.createTool({ ...body, siteId: site.id })).id;
    if (unchanged) console.log(`draft already in the API as ${apiToolId} (unchanged since compile)`);
  }
  const tool = await api.approveTool(toolId);
  const site = sites.find((s) => s.id === tool.siteId);
  console.log(`approved ${site ? mcpToolName(site, tool) : tool.name} v${tool.version} (${tool.steps.length} steps), id ${tool.id}`);
  console.log("The MCP server lists it within ~10 s (reconnect the client to refresh).");
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});

/** Same rule as @mcpify/compiler draftHash: hash of the publishable fields. */
function draftHash(draft: Record<string, unknown>): string {
  const { examples: _e, warnings: _w, validation: _v, status: _s, apiToolId: _i, apiToolHash: _h, ...body } = draft;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
