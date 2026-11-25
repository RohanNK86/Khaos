import { RunSchema, SiteSchema, ToolSchema, type Run, type Site, type Tool } from "@mcpify/contracts";

export interface Manifest {
  site: Site;
  tools: Tool[];
}

/** Validate a `/sites/manifest` body; drops tools that are invalid or not approved. */
export function parseManifest(body: unknown): Manifest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { site?: unknown; tools?: unknown };
  const site = SiteSchema.safeParse(b.site);
  if (!site.success || !Array.isArray(b.tools)) return null;
  const tools = b.tools
    .map((t) => ToolSchema.safeParse(t))
    .flatMap((r) => (r.success && r.data.status === "approved" ? [r.data as Tool] : []));
  return { site: site.data as Site, tools };
}

export async function fetchManifest(apiBase: string, origin: string, f: typeof fetch = fetch): Promise<Manifest | null> {
  try {
    const r = await f(`${apiBase}/sites/manifest?origin=${encodeURIComponent(origin)}`);
    return r.ok ? parseManifest(await r.json()) : null;
  } catch {
    return null;
  }
}

/** POST /runs/report; returns the stored id, or null when the API is unreachable. */
export async function reportRun(apiBase: string, run: Run, f: typeof fetch = fetch): Promise<string | null> {
  try {
    const body = RunSchema.parse(run);
    const r = await f(`${apiBase}/runs/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const out = (await r.json()) as { id?: unknown };
    return typeof out.id === "string" ? out.id : null;
  } catch {
    return null;
  }
}
