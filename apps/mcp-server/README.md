# @mcpify/mcp-server

Remote MCP server (streamable HTTP, stateless) at `http://localhost:4100/mcp` (env `MCP_PORT`), plus a **live run view** at `http://localhost:4100/`.
It is a thin client of the MCPify API (`API_URL`, default `http://localhost:4000`, see `apps/api`): the API owns tools, runs, browsers and receipts.

- `tools/list`: every approved tool from `GET /sites` + `GET /tools?status=approved` (cached ~10 s) as `<site>__<tool>`, plus
  `mcpify_continue`, `mcpify_get_run`, `mcpify_cancel`, `mcpify_verify_receipt`.
- Tool calls → `POST /runs`; `mcpify_continue` → `POST /runs/:id/continue`; `mcpify_cancel` → `/cancel`; `mcpify_get_run` → `GET /runs/:id`.
  Each returns `ToolCallResult` JSON (01-CONTRACTS §12) as soon as the run pauses or ends.
- Every tool takes an extra `mcpify_dry_run` flag. Sites with `mode: "user_only"` are always dry-run (the API adds the network guard).
- The live view reads runs from the API (`/api/runs` here).

Start: `pnpm demo` from the repo root (API + portals + MCP server). Claude Code opened in the repo picks the server up from `.mcp.json`.

Approve a compiled draft (API must be running):
```bash
pnpm --filter @mcpify/mcp-server approve <draft.json> [--site scholarship]   # POST /tools + POST /tools/:id/approve
pnpm --filter @mcpify/mcp-server approve --id <toolId>                         # approve a draft already in the API
```
