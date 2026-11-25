# @mcpify/agent-ready: mcpify.js, the one script tag

```html
<script src="https://<mcpify-api>/static/mcpify.js" data-site="scholarship" defer></script>
```
Site owners add this one tag. The script:
1. Uses its own `src` origin as the API base and reads `data-site`.
2. Fetches `GET /sites/manifest?origin=<location.origin>` (approved tools only, validated with `@mcpify/contracts`).
   No manifest → logs `[mcpify] no approved tools…` and does nothing.
3. Registers every tool with **WebMCP** through `src/webmcp-adapter.ts` (the only module that touches WebMCP):
   `document.modelContext` (current draft) or `navigator.modelContext` (older drafts) when the browser has it,
   otherwise it loads **@mcp-b/global** (bundled), which installs the W3C polyfill on `document.modelContext`
   and bridges it to MCP-B transports. Each tool gets an extra `mcpify_dry_run` boolean.
4. Runs tools **in the page** with the engine + DomDriver. Pauses show a small MCPify-styled modal (shadow DOM):
   confirmation with a preview before every send, OTP/CAPTCHA typed by the user, file picker for uploads.
5. Survives full page reloads (server-rendered multi-page forms): before each click/navigation the run state
   (`runId`, `toolId`, `stepIndex`, inputs **minus sensitive values**, committed step ids, trace so far) is saved in
   `sessionStorage`; on the next page the script verifies the pending step's post conditions and continues.
6. Reports the final run to `POST /runs/report`, saves it as `sessionStorage["mcpify:last-run"]` and dispatches
   `mcpify:run`.

Debug API: `window.MCPify.tools`, `window.MCPify.run(name, inputs)`, `window.MCPify.lastRun()`,
`window.MCPify.webmcp` (`{ provider: "native" | "mcp-b" | "none", registered }`), and the `mcpify:ready` event.

**Limitation:** a WebMCP/`MCPify.run` call whose tool reloads the page cannot return its result to the original
caller (that JS context is gone). The run still finishes on the next page; read it from `MCPify.lastRun()`, the
`mcpify:run` event, or the API.

## Build
```bash
pnpm --filter @mcpify/agent-ready build   # → packages/agent-ready/dist/mcpify.js (IIFE, minified)
```
The API serves this file at `/static/mcpify.js` (`apps/api/src/routes/static.ts`), so build it before starting the API.
`IN_PAGE_JS` (the shared locator rules) is inlined as code at build time, so the script needs no `eval` (CSP-friendly).

## Tests
`pnpm --filter @mcpify/agent-ready test`
- `tests/unit.test.ts`: WebMCP adapter (native / older navigator / MCP-B polyfill / none), manifest parsing, results, reporting.
- `tests/dom-resume.e2e.test.ts` (engine E3): a bundled `@mcpify/engine/dom` harness injected into Portal 1 runs the golden
  `apply_scholarship` tool across two full page reloads in dry run and stops at Send OTP; nothing is created.
- `tests/mcpify.e2e.test.ts`: Portal 1 with `?owner=1` loads mcpify.js from a stub API (port 0); `MCPify.tools` lists
  `apply_scholarship` + `check_application_status`, WebMCP has both, and `MCPify.run("check_application_status")`
  succeeds across two reloads and is reported.
