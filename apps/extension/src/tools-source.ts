import { SiteSchema, ToolSchema, type Site, type Tool } from "@mcpify/contracts";
import applyScholarship from "../../../fixtures/tools/scholarship.apply_scholarship.v1.json";
import checkStatus from "../../../fixtures/tools/scholarship.check_application_status.v1.json";
import sites from "../../../fixtures/sites.json";

export const DEFAULT_API_BASE = "http://localhost:4000";

export interface ToolSource {
  source: "api" | "bundled" | "none";
  site: Site | null;
  tools: Tool[];
}

/** Validate a `/sites/manifest` body; keeps only valid approved tools. */
export function parseManifest(body: unknown): { site: Site; tools: Tool[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { site?: unknown; tools?: unknown };
  const site = SiteSchema.safeParse(b.site);
  if (!site.success || !Array.isArray(b.tools)) return null;
  const tools = b.tools.map((t) => ToolSchema.safeParse(t)).flatMap((r) => (r.success && r.data.status === "approved" ? [r.data as Tool] : []));
  return { site: site.data as Site, tools };
}

/** Golden tools shipped with the extension, used when the API is not reachable. */
export function bundledTools(origin: string): ToolSource {
  const tools = [applyScholarship, checkStatus].map((t) => ToolSchema.parse(t) as Tool).filter((t) => new URL(t.startUrl).origin === origin);
  const site = sites.map((s) => SiteSchema.parse(s) as Site).find((s) => s.origin === origin) ?? null;
  return tools.length ? { source: "bundled", site, tools } : { source: "none", site: null, tools: [] };
}

/** API manifest first; bundled golden tools for the demo portal origins as a fallback. */
export async function loadTools(apiBase: string, origin: string, f: typeof fetch = fetch): Promise<ToolSource> {
  try {
    const r = await f(`${apiBase}/sites/manifest?origin=${encodeURIComponent(origin)}`);
    const m = r.ok ? parseManifest(await r.json()) : null;
    if (m && m.tools.length) return { source: "api", site: m.site, tools: m.tools };
  } catch {
    // API down: fall through to the bundled tools
  }
  return bundledTools(origin);
}
