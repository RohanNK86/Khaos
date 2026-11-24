# @mcpify/mcp-server

Remote MCP server (streamable HTTP, stateless) at `http://localhost:4100/mcp`, plus a **live run view** at `http://localhost:4100/`.

- `tools/list`: every approved tool as `<site>__<tool>` (from `fixtures/tools/*.json` and `.data/tools/approved/*.json`), plus
  `mcpify_continue`, `mcpify_get_run`, `mcpify_cancel`, `mcpify_verify_receipt`.
- Each tool call returns `ToolCallResult` JSON (01-CONTRACTS §12) as soon as the run pauses or ends.
- Every tool takes an extra `mcpify_dry_run` flag. Sites with `mode: "user_only"` are always dry-run.
- Runs use a **visible** Chromium window with each action highlighted (set `HEADLESS=1` to hide it).
- Succeeded runs that sent something get an Ed25519-signed receipt (`.data/receipts/`).

Start: `pnpm demo` from the repo root (portal + MCP server). Claude Code opened in the repo picks the server up from `.mcp.json`.
