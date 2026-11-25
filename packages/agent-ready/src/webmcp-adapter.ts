/**
 * The ONLY module that talks to WebMCP / MCP-B. The WebMCP draft is still moving, so everything
 * else in mcpify.js goes through this small interface.
 *
 * Current draft (and @mcp-b/global 6.x): `document.modelContext.registerTool(tool, { signal })`,
 * `getTools()`, `executeTool(tool, input)`. Older drafts used `navigator.modelContext`; we accept both.
 * When neither exists we load @mcp-b/global, which installs the W3C polyfill on `document.modelContext`
 * and bridges it to MCP-B transports so MCP-B extensions/agents can discover the tools.
 */

export interface CallToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  execute(args: Record<string, unknown>): Promise<CallToolResult>;
}

/** The part of a model context we use (native, W3C polyfill or MCP-B). */
export interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  getTools?(): Promise<{ name: string }[]>;
}

export type WebMcpProvider = "native" | "mcp-b" | "none";

export interface WebMcpAdapter {
  readonly provider: WebMcpProvider;
  readonly registered: string[];
  register(tool: WebMcpTool): Promise<void>;
  unregisterAll(): void;
}

export interface AdapterEnv {
  doc: Document;
  nav: Navigator;
  /** Loads the MCP-B runtime; it installs `document.modelContext` as a side effect. */
  loadPolyfill(): Promise<void>;
}

const contextOf = (env: AdapterEnv): ModelContextLike | undefined =>
  (env.doc as { modelContext?: ModelContextLike }).modelContext ?? (env.nav as { modelContext?: ModelContextLike }).modelContext;

export async function createWebMcpAdapter(env: AdapterEnv): Promise<WebMcpAdapter> {
  let provider: WebMcpProvider = "native";
  let ctx = contextOf(env);
  if (!ctx) {
    provider = "mcp-b";
    await env.loadPolyfill().catch((e: unknown) => console.warn("[mcpify] could not load the MCP-B polyfill", e));
    ctx = contextOf(env);
  }
  if (!ctx) provider = "none";
  const registered: string[] = [];
  const aborts: AbortController[] = [];
  return {
    provider,
    registered,
    async register(tool) {
      if (!ctx) return;
      const ac = new AbortController();
      await ctx.registerTool(tool, { signal: ac.signal });
      aborts.push(ac);
      registered.push(tool.name);
    },
    unregisterAll() {
      for (const ac of aborts.splice(0)) ac.abort();
      registered.splice(0);
    },
  };
}

/** Default polyfill loader used by the bundle (esbuild inlines the dynamic import). */
export async function loadMcpB(): Promise<void> {
  await import("@mcp-b/global");
}
