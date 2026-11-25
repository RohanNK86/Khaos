# @mcpify/engine: the verified engine

`runTool(tool, inputs, driver, hooks, opts)` runs each step as **CHECK pre → risk gate → EXECUTE → VERIFY post**. No model calls.

- `commit` steps: `dryRun` → `blocked_dry_run` + `dry_run_complete`; otherwise `hooks.onNeed({kind:"confirmation"})`.
- `userInput` steps (OTP, CAPTCHA): `hooks.onNeed({kind:"user_input"})`; the value is typed once and never stored.
- Failure → `status:"failed"`, `failedStepId`, evidence snapshot via `hooks.saveBlob`, and the page's own error text in `trace.error`.

```ts
import { runTool } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";
const run = await runTool(tool, inputs, createPlaywrightDriver(page, { showActions: true }), hooks, { dryRun: false, mode: "owner" });
```

Entry points: `@mcpify/engine` (isomorphic core), `@mcpify/engine/playwright`, `@mcpify/engine/dom` (`createDomDriver(document)` + `runToolInPage` / `resumeToolInPage` to survive page reloads, used by the extension and mcpify.js), `@mcpify/engine/network-guard`, `@mcpify/engine/in-page`, `@mcpify/engine/fake` (unit-test driver).
The in-page locator resolver (`src/in-page.ts`) is plain JS so the DomDriver/extension can reuse it.
Additions to 01-CONTRACTS: optional `Driver.errors()`, `RunHooks.loadFile(ref)`, `RunOptions.runId` / `committedStepIds`.

Tests: `pnpm --filter @mcpify/engine test` (unit tests with FakeDriver + integration against Portal 1).
