import type { Run, Site, ToolCallResult } from "@mcpify/contracts";
import type { InPageInstaller } from "@mcpify/engine/dom";
import { fetchManifest } from "./api.js";
import { createPauseUi } from "./modal.js";
import { createRuntime } from "./runtime.js";
import { createWebMcpAdapter, loadMcpB, type WebMcpProvider } from "./webmcp-adapter.js";

export interface McpifyGlobal {
  site: Site;
  tools: { name: string; title: string; description: string; inputSchema: Record<string, unknown> }[];
  run(name: string, inputs: Record<string, unknown>): Promise<ToolCallResult>;
  lastRun(): Promise<Run | null>;
  webmcp: { provider: WebMcpProvider; registered: string[] };
}

declare global {
  interface Window {
    MCPify?: McpifyGlobal;
  }
}

export interface BootOptions {
  win: Window & typeof globalThis;
  apiBase: string;
  site?: string;
  install?: InPageInstaller;
  fetch?: typeof fetch;
  loadPolyfill?: () => Promise<void>;
}

const log = (...a: unknown[]) => console.info("[mcpify]", ...a);

/** Fetch the manifest, expose window.MCPify, register WebMCP tools, resume an interrupted run. */
export async function createMcpify(o: BootOptions): Promise<McpifyGlobal | null> {
  const { win } = o;
  const doc = win.document;
  const manifest = await fetchManifest(o.apiBase, win.location.origin, o.fetch);
  if (!manifest || manifest.tools.length === 0) {
    log(`no approved tools for ${win.location.origin} at ${o.apiBase}; doing nothing`);
    return null;
  }
  if (o.site && o.site !== manifest.site.slug) log(`data-site="${o.site}" but the API knows this origin as "${manifest.site.slug}"`);
  const runtime = createRuntime({
    doc, apiBase: o.apiBase, tools: manifest.tools, ui: createPauseUi(doc), storage: win.sessionStorage, install: o.install, fetch: o.fetch,
  });
  const adapter = await createWebMcpAdapter({ doc, nav: win.navigator, loadPolyfill: o.loadPolyfill ?? loadMcpB });
  for (const t of manifest.tools) {
    await adapter.register(runtime.webMcpTool(t)).catch((e: unknown) => log(`WebMCP registration of ${t.name} failed`, e));
  }
  const api: McpifyGlobal = {
    site: manifest.site,
    tools: manifest.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })),
    run: runtime.run,
    lastRun: runtime.lastRun,
    webmcp: { provider: adapter.provider, registered: adapter.registered },
  };
  win.MCPify = api;
  win.dispatchEvent(new win.CustomEvent("mcpify:ready", { detail: { tools: api.tools.map((t) => t.name) } }));
  log(`${api.tools.length} tools ready (WebMCP: ${adapter.provider})`);
  void runtime.resume().catch((e: unknown) => log("resume failed", e));
  return api;
}
