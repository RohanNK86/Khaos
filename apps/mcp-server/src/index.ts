import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { buildMcpServer } from "./mcp.js";
import { LIVE_PAGE } from "./live-page.js";
import { Registry } from "./registry.js";
import { RunManager, type ManagerOptions } from "./run-manager.js";

export { buildMcpServer, Registry, RunManager };

/** HTTP app: stateless streamable-HTTP MCP endpoint at /mcp + live view and JSON at /api. */
export function createMcpHttpApp(opts: ManagerOptions & { registry?: Registry } = {}) {
  const registry = opts.registry ?? new Registry();
  const runs = new RunManager(opts);
  const app = createMcpExpressApp({ host: "localhost" });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = buildMcpServer(registry, runs);
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

  app.get("/health", (_req, res) => { res.json({ ok: true, tools: registry.entries().map((e) => e.mcpName) }); });
  app.get("/", (_req, res) => { res.type("html").send(LIVE_PAGE); });
  app.get("/api/runs", (_req, res) => {
    res.json(runs.list().slice(0, 20).map((r) => {
      const tool = runs.toolOf(r.id);
      return { ...r, blockedRequests: runs.blockedOf(r.id), toolName: tool?.name, toolTitle: tool?.title, steps: tool?.steps.map((s) => ({ id: s.id, intent: s.intent, risk: s.risk })) ?? [] };
    }));
  });
  app.get("/api/receipts/:id", (req, res) => {
    const r = runs.getReceipt(req.params.id);
    if (r) res.json(r);
    else res.status(404).json({ error: "not found" });
  });
  return { app, runs, registry };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.MCP_PORT ?? 4100);
  const { app, registry, runs } = createMcpHttpApp({ headless: process.env.HEADLESS === "1" });
  const server = app.listen(port, () => {
    console.log(`[mcp] MCPify MCP server: http://localhost:${port}/mcp`);
    console.log(`[mcp] live run view:     http://localhost:${port}/`);
    console.log(`[mcp] tools: ${registry.entries().map((e) => e.mcpName).join(", ") || "(none approved yet)"}`);
  });
  const shutdown = () => { server.close(); void runs.close().then(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
