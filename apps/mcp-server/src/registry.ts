import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SiteSchema, ToolSchema, mcpToolName, type Site, type Tool } from "@mcpify/contracts";
import { DATA, p } from "./paths.js";

export interface Entry { mcpName: string; tool: Tool; site: Site }

/**
 * Approved tools come from JSON files (no database for the demo):
 * fixtures/tools/*.json (golden, hand-written) and .data/tools/approved/*.json (compiled + approved).
 * Same MCP name in both → the most recently updated one wins.
 */
export class Registry {
  constructor(
    private toolDirs = [p("fixtures/tools"), join(DATA, "tools/approved")],
    private sitesFiles = [p("fixtures/sites.json"), join(DATA, "sites.json")],
  ) {}

  sites(): Site[] {
    const out = new Map<string, Site>();
    for (const f of this.sitesFiles) {
      if (!existsSync(f)) continue;
      for (const s of JSON.parse(readFileSync(f, "utf8")) as unknown[]) {
        const site = SiteSchema.parse(s);
        out.set(site.id, site);
      }
    }
    return [...out.values()];
  }

  entries(): Entry[] {
    const sites = new Map(this.sites().map((s) => [s.id, s]));
    const byName = new Map<string, Entry>();
    for (const dir of this.toolDirs) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
        const parsed = ToolSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
        if (!parsed.success) {
          console.error(`[registry] skipping invalid tool ${f}: ${parsed.error.issues[0]?.message}`);
          continue;
        }
        const tool = parsed.data as Tool;
        const site = sites.get(tool.siteId);
        if (tool.status !== "approved" || !site) continue;
        const mcpName = mcpToolName(site, tool);
        const prev = byName.get(mcpName);
        if (!prev || prev.tool.updatedAt <= tool.updatedAt) byName.set(mcpName, { mcpName, tool, site });
      }
    }
    return [...byName.values()];
  }

  find(mcpName: string): Entry | undefined {
    return this.entries().find((e) => e.mcpName === mcpName);
  }
}
