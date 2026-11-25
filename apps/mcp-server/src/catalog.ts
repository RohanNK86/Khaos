import { mcpToolName, type Site, type Tool } from "@mcpify/contracts";
import type { ApiClient } from "./api-client.js";

export interface Entry {
  mcpName: string;
  tool: Tool;
  site: Site;
}

const TTL_MS = 10_000;

/** Approved tools from the API as MCP entries, cached ~10 s. Also caches tool versions for run messages. */
export class Catalog {
  private cache?: { at: number; entries: Promise<Entry[]> };
  private versions = new Map<string, Promise<Tool>>();

  constructor(private api: ApiClient, private ttlMs = TTL_MS) {}

  entries(): Promise<Entry[]> {
    if (!this.cache || Date.now() - this.cache.at > this.ttlMs) {
      const entries = this.load();
      this.cache = { at: Date.now(), entries };
      entries.catch(() => (this.cache = undefined));
    }
    return this.cache.entries;
  }

  async find(mcpName: string): Promise<Entry | undefined> {
    return (await this.entries()).find((e) => e.mcpName === mcpName);
  }

  /** A specific tool version (immutable, so cached forever). */
  toolOf(id: string, version: number): Promise<Tool> {
    const key = `${id}@${version}`;
    let t = this.versions.get(key);
    if (!t) {
      t = this.api.toolVersion(id, version);
      t.catch(() => this.versions.delete(key));
      this.versions.set(key, t);
    }
    return t;
  }

  private async load(): Promise<Entry[]> {
    const [sites, tools] = await Promise.all([this.api.sites(), this.api.approvedTools()]);
    const byId = new Map(sites.map((s) => [s.id, s]));
    const out = new Map<string, Entry>();
    for (const tool of tools) {
      const site = byId.get(tool.siteId);
      if (!site) continue;
      const mcpName = mcpToolName(site, tool);
      const prev = out.get(mcpName);
      if (!prev || prev.tool.updatedAt <= tool.updatedAt) out.set(mcpName, { mcpName, tool, site });
    }
    return [...out.values()];
  }
}
