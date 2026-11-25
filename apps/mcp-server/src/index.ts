import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import type { Run } from "@mcpify/contracts";
import { ApiClient, ApiError } from "./api-client.js";
import { Catalog } from "./catalog.js";
import { LIVE_PAGE } from "./live-page.js";
import { buildMcpServer } from "./mcp.js";
import { p } from "./paths.js";

export { ApiClient, buildMcpServer, Catalog };

export interface McpHttpOptions {
  /** Base URL of apps/api (default env API_URL or http://localhost:4000). */
  apiUrl?: string;
  /** tools/list cache lifetime. */
  cacheMs?: number;
}

/** HTTP app: stateless streamable-HTTP MCP endpoint at /mcp + live run view at / (data from the API). */
export function createMcpHttpApp(opts: McpHttpOptions = {}) {
  const api = new ApiClient(opts.apiUrl);
  const catalog = new Catalog(api, opts.cacheMs);
  const app = createMcpExpressApp({ host: "localhost" });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = buildMcpServer(catalog, api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp] request failed", e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  const fail = (res: Response, e: unknown) => {
    res.status(e instanceof ApiError ? e.status : 502).json({ error: (e as Error).message });
  };
  app.get("/health", async (_req, res) => {
    try {
      res.json({ ok: true, api: api.baseUrl, tools: (await catalog.entries()).map((e) => e.mcpName) });
    } catch (e) {
      fail(res, e);
    }
  });
  app.get("/", (_req, res) => { res.type("html").send(LIVE_PAGE); });
  app.get("/api/runs", async (_req, res) => {
    try {
      res.json(await Promise.all((await api.listRuns(20)).map((r) => liveView(r))));
    } catch (e) {
      fail(res, e);
    }
  });
  app.get("/api/receipts/:id", async (req, res) => {
    try {
      res.json(await api.getReceipt(req.params.id));
    } catch (e) {
      fail(res, e);
    }
  });

  /** What the live page needs: the run plus its tool's steps and any requests the dry-run guard blocked. */
  async function liveView(r: Run) {
    const tool = await catalog.toolOf(r.toolId, r.toolVersion).catch(() => undefined);
    const blockedRequests = r.dryRun ? await api.blocked(r.id).catch(() => []) : [];
    return { ...r, blockedRequests, toolName: tool?.name, toolTitle: tool?.title, steps: tool?.steps.map((s) => ({ id: s.id, intent: s.intent, risk: s.risk })) ?? [] };
  }

  return { app, api, catalog };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    process.loadEnvFile(p(".env"));
  } catch {
    // .env is optional
  }
  const port = Number(process.env.MCP_PORT ?? 4100);
  const { app, api, catalog } = createMcpHttpApp();
  const server = app.listen(port, () => {
    console.log(`[mcp] MCPify MCP server: http://localhost:${port}/mcp (API ${api.baseUrl})`);
    console.log(`[mcp] live run view:     http://localhost:${port}/`);
    catalog.entries().then(
      (es) => console.log(`[mcp] tools: ${es.map((e) => e.mcpName).join(", ") || "(none approved yet)"}`),
      (e: Error) => console.log(`[mcp] API not ready yet (${e.message}); tools load on the first tools/list`),
    );
  });
  const shutdown = () => { server.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
