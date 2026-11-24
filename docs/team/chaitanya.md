# Chaitanya: verified engine, drivers, extension (user mode), mcpify.js (WebMCP), real-site dry-run

**Start Claude Code in the repo root and say:**
> I am Chaitanya. Read CLAUDE.md, then docs/00-ARCHITECTURE.md, docs/01-CONTRACTS.md, docs/02-PLAN-AND-SYNC.md, docs/STATUS.md and docs/team/chaitanya.md. Execute my plan phase by phase, following the waiting protocol. Before each phase, tell me what you're about to do.

You own: `packages/engine`, `apps/extension`, `packages/agent-ready`, `fixtures/tools`.
The engine (**C4**) is what every other part runs on. Keep its core **isomorphic**: no Node or DOM imports in `@mcpify/engine` core, only in the driver entry points.

---

## Phase E1: Engine core with stubs (Day 1–2)
**Depends on:** C0. **Stub allowed:** copy the contract types into `packages/engine/src/contracts-stub.ts` until C1 is ✅, then switch to `@mcpify/contracts`.

Implement `runTool` exactly as specified in 01-CONTRACTS §13 ("Engine semantics"):
1. Locator resolution: try each locator in order; accept only **exactly one visible** match; record `usedLocator`.
2. Condition evaluation with polling (every 150 ms until `timeoutMs`, default 8000). `extract` with an optional regex writes `outputs[as]`.
3. Risk gates: `commit` → `dryRun` ? `blocked_dry_run` + finish `dry_run_complete` : `onNeed(confirmation)`; `auth` + `userInput` → `onNeed(user_input)`; the value is used once and **never** stored in the trace or run.
4. Failure → `snapshot()` → `saveBlob` → `failedStepId`, `status:"failed"`, `evidenceBlobId`.
5. Idempotency: a `commit` step never runs twice in one run, even if `runTool` is resumed with `startIndex`.
6. `AbortSignal` support (cancel → `stopped`).
7. A **FakeDriver** (in-memory DOM model) for unit tests covering every branch: locator fallback, ambiguous match, pre fail, post fail, dry-run block, confirmation reject, user input, extract, abort.

**Acceptance:** `pnpm --filter @mcpify/engine test` covers every branch above and passes.

## Phase E2: Golden tool + PlaywrightDriver → **C4** (Day 2–3)
**Depends on:** C1, C2 (Portal 1).

1. Hand-write `fixtures/tools/scholarship.apply_scholarship.v1.json`: a complete, valid `Tool` for Portal 1 (every field on pages 1–3, the upload, Send OTP as `commit`, OTP and CAPTCHA as `auth` `userInput`, final Submit as `commit`, `extract` application_id). Validate it with `ToolSchema`. This is the **golden target** Rohan's compiler aims for and the tool Subhash's MCP server uses before the compiler is ready, so push it **as early as possible** (Day 2), even before the driver works.
2. `@mcpify/engine/playwright`: `createPlaywrightDriver(page)` implementing `Driver`. Locator mapping: testid → `[data-testid=…],[data-mcpify=…]`; label → `page.getByLabel` plus a fallback for table-cell labels (find the `<td>` with that text, then the input in the next cell); role → `getByRole`; text → `getByText({exact:true})`; near → anchor text then the first following `tag`. `waitForSettled` = wait for `networkidle` or `load`, with a timeout.
3. Integration test: run the golden tool on Portal 1 with hooks that auto-approve confirmations and read the OTP from `/__lab/otp` (and the CAPTCHA from the page in test mode only). Assert `succeeded` and that `outputs.application_id` matches `SSP-2026-\d{6}`.
4. Also test dry-run: it fills pages 1–2, stops at the first commit with `dry_run_complete`, and **no application is created** (check `/__lab/state`).

**Claude Code prompt:**
> Do Phase E2 in docs/team/chaitanya.md. First write and push the golden tool fixture for Portal 1, then implement the Playwright driver and the integration tests (full run plus dry-run) against http://localhost:5101. When both pass, mark C4 ✅ and push.

**Acceptance:** both integration tests pass three times in a row.
→ Mark **C4** ✅ (unblocks Subhash C7 and Rohan C6/C12).

## Phase E3: DomDriver (Day 4)
**Depends on:** C4.
`@mcpify/engine/dom`: `createDomDriver(document)` implementing the same `Driver` with plain DOM APIs (it runs inside the page or a content script). Fill must dispatch `input` and `change` events and use the native value setter so framework-controlled inputs update. Label resolution as in the Playwright driver. Navigation: for steps that change pages, the run has to **resume after reload**, so persist `{runId, toolId, stepIndex, inputs minus sensitive values}` in `sessionStorage` (extension: `chrome.storage.session`) and resume with `startIndex`.
Test with Vitest + `happy-dom` or `jsdom`, plus a Playwright test that injects the DomDriver into Portal 1.

## Phase E4: Chrome extension, user mode + dry-run guard → **C9** (Day 4–6)
**Depends on:** C4, C5. **Stub allowed:** use the golden tool from `fixtures/` if the API isn't up.

`apps/extension` (Manifest V3, built with Vite or esbuild; **check the current Chrome extension docs** for MV3 side panel and declarativeNetRequest APIs):
1. **Side panel** UI in our theme: shows "MCPify tools for this site" (from `GET /sites/manifest?origin=` plus a "user mode" library of approved tools where `site.mode = user_only`).
2. Picking a tool renders a form from its `inputSchema`. **Run** executes it in the active tab with the DomDriver through a content script. A live step timeline, a **confirmation dialog** with the preview, an **OTP/CAPTCHA prompt** (the human types it), and a final outputs + receipt view. Report the final run to `POST /runs/report`.
3. **Dry-run toggle (default ON for any site not in our demo list):** when ON, install `declarativeNetRequest` session rules that **block POST, PUT, PATCH and DELETE requests to the current tab's origin** (`requestMethods` condition) and also skip `commit` steps in the engine. Show a banner on the page: "DRY RUN: nothing will be sent". Log every blocked request in the panel ("3 commit requests blocked").
4. Optional **chat mode**: a text box where the user describes the task; the panel calls `POST /agent/step` (Subhash) with the site's tools as Claude tools, executes returned `tool_use` blocks locally with the engine, and sends `tool_result`s back until the model is done. API keys never live in the extension.
5. Permissions: as narrow as possible (`sidePanel`, `storage`, `declarativeNetRequest`, `scripting`, `activeTab`, host permissions only for our API and demo portals plus sites the user explicitly enables).

**Acceptance:** on Portal 1 with dry-run OFF, a full run succeeds from the side panel with you typing the OTP. With dry-run ON, the run stops at the first commit, the network log shows the blocked POST, and `/__lab/state` shows no new application.
→ Mark **C9** ✅.

## Phase E5: mcpify.js, the one script tag (WebMCP) → **C10** (Day 6–7)
**Depends on:** C5, C9.

`packages/agent-ready` builds a single file `mcpify.js` (an IIFE bundle with the engine core and DomDriver). Subhash serves it from the API at `/static/mcpify.js` (put a request in `docs/requests/subhash.md`).
1. It reads `data-site` from its own `<script>` tag, fetches `/sites/manifest?origin=location.origin`, and **registers each approved tool with WebMCP** (`navigator.modelContext`). **Read the current WebMCP explainer and the MCP-B docs first**; the API is still changing, so put all WebMCP calls behind one small adapter module (`webmcp-adapter.ts`).
2. If `navigator.modelContext` doesn't exist, load the **MCP-B polyfill** (check the current package name and usage in their docs) so MCP-B-compatible extensions and agents can discover the tools.
3. Tool execution inside the page uses the engine + DomDriver; pauses (confirmation, OTP) render a small in-page modal in our style; the final run is reported to the API.
4. Expose `window.MCPify.tools` and a `mcpify:ready` event for debugging.

**Acceptance:** Portal 1 with `OWNER_MODE=1` loads mcpify.js; an MCP-B-compatible client (or a test page calling the adapter) lists `apply_scholarship`, `check_status` etc. and runs one end to end.
→ Mark **C10** ✅.

## Phase E6: Real government websites, dry-run → **C17** (Day 7–8)
**Depends on:** C9.
1. With Sinchana, shortlist **2–3 real government pages**: status/result lookups (read-only) and page 1 of an application form (fill-only). Read each site's terms and website policy and skip any that forbid automated tools. Prefer pages that need no login.
2. For each: open DevTools → Network, note which buttons send requests; these become `commit` steps. Record the flow with Rohan's recorder **in dry-run** (the recorder must not click commit buttons on real sites: add a `--dry-run` flag to the recorder through `docs/requests/rohan.md`, or record only the fill part).
3. Mark these sites `user_only` and keep dry-run forced ON for them in the extension (hard-coded allowlist of demo origins; everything else is dry-run).
4. Use a teammate's **own** details with their consent, or obvious dummy values. Never trigger a real OTP. Never solve a CAPTCHA automatically. A handful of runs only.
5. Record a 30-second screen video per site of the fill + blocked sends, for the pitch.

**Acceptance:** for each real site, the extension fills the form in dry-run and the log shows every commit request blocked and **zero** data sent.
→ Mark **C17** ✅.

## Phase E7: Hardening (Day 9)
Run the engine against all approved tools on all three portals in a loop (20 runs each); fix flaky waits. Make sure traces never contain sensitive values (write a test).
