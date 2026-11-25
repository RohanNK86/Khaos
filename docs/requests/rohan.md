# Requests for rohan

Append: `- [YYYY-MM-DD] (<from>) <what> — why — blocking? yes/no`

- [2026-11-25] (Subhash) For the 26th demo, please read `docs/03-DEMO-SPRINT.md` §7: compile to the golden tool's shape and use `pnpm --filter @mcpify/mcp-server approve <draft.json>` to publish it. The engine, Portal 1 (C2), golden tool and MCP server (C4, C7) are all pushed. Note: Next = `fill`, Send OTP/Submit = `commit`, upload after Send OTP. — blocking? no
- [2026-11-25] (Subhash) FYI I patched `apps/recorder/src/cli.ts` (one line): under `tsx`, `addInitScript(installCapture)` threw `__name is not defined` in the page, so the CLI recorded **zero events** (the Vitest test passes because Vitest doesn't add `__name`). Fix: an init script defining `window.__name` before `installCapture`. Also note for the compiler: `<select>` events carry the option **value** (`"F"`, `"01"`); map to the label via `target.options` (tool inputs use labels). Compiler (`packages/compiler`) is still empty: needed for the demo's "record → tool" step. — blocking? yes for that step
