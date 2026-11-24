# Rohan: recorder, compiler (Semantic Step Contracts), verified selective repair

**Start Claude Code in the repo root and say:**
> I am Rohan. Read CLAUDE.md, then docs/00-ARCHITECTURE.md, docs/01-CONTRACTS.md, docs/02-PLAN-AND-SYNC.md, docs/STATUS.md and docs/team/rohan.md. Execute my plan phase by phase, following the waiting protocol. Before each phase, tell me what you're about to do.

You own: `apps/recorder`, `packages/compiler`, `packages/repair`.
You build the **two core innovations**: compiling a demonstration into Semantic Step Contracts, and Verified Selective Repair.

---

## Phase R1: Capture script spike (Day 1)
**Depends on:** C0. **Stub allowed:** copy the contract types into `apps/recorder/src/contracts-stub.ts` until C1 is ✅. Use any simple local HTML page for testing until Portal 1 (C2) exists.

1. Write `apps/recorder/src/capture.ts`: a script injected into every page with Playwright `context.addInitScript`. It listens (capture phase) for `click`, `input` (debounced 400 ms, keep the last value), `change`, `submit` and `keydown` Enter, and computes an **ElementFingerprint** (01-CONTRACTS §7):
   - `label`: `<label for=id>`, a wrapping label, `aria-labelledby`, or the nearest preceding table cell text (legacy forms put labels in a `<td>` to the left). Normalise whitespace and strip `*` and `:`.
   - `nearText`: nearest visible heading or legend text above the element.
   - `cssPath` (shortest unique path) and `xpath`.
   - `options` for `<select>`; `testid` from `data-testid` or `data-mcpify`.
   - Mask the value for `type=password` and for any field whose label matches `/otp|captcha|password|pin|aadhaar/i`. Record the event but set `value:"•••"` and flag it.
2. Send events to Node with `page.exposeBinding("__mcpifyRecord", ...)`.
3. After each event, wait for the network to settle, then save `page.content()` as a DOM snapshot (the local blob dir until `@mcpify/storage` is ready).

**Acceptance:** on a sample form, the recorded JSON has correct labels, values, and masked password/OTP values.

## Phase R2: Recorder CLI → **C3** (Day 2–3)
**Depends on:** C1, C2.

1. CLI: `pnpm --filter @mcpify/recorder record --site scholarship --task apply_scholarship [--url http://localhost:5101/apply/1]`. It opens a **headed** Chromium; the human performs the task; pressing **Ctrl+Shift+S** in the page (or typing `done` in the terminal) stops recording.
2. Collapse noise: merge repeated inputs on one field, drop clicks on labels that only focus inputs, add `navigate` events from `page.on("framenavigated")`.
3. Output a valid `Recording` (validate with `RecordingSchema`), save it to `recordings/<task>-<timestamp>.json` (git-ignored) **and** `POST /recordings` when the API is up (skip with a warning if not).
4. Snapshots go through `@mcpify/storage` once C5b is ✅ (before that, local files).

**Claude Code prompt:**
> Do Phase R2 in docs/team/rohan.md. Build the recorder CLI on top of the capture script, run it against Portal 1 (http://localhost:5101), complete one scholarship application manually, and check the Recording validates against RecordingSchema. Then mark C3 ✅ and push.

**Acceptance:** a full Portal 1 application recorded; the JSON validates; OTP and CAPTCHA values are masked.
→ Mark **C3** ✅.

## Phase R3: Compiler, deterministic pass (Day 3–4)
**Depends on:** C3. Uses Chaitanya's golden tool `fixtures/tools/scholarship.apply_scholarship.v1.json` as the **target shape**. If it isn't there yet, work from 01-CONTRACTS and align later.

`packages/compiler`, `compile(recording): Promise<ToolDraft>`, in two passes. This phase is pass 1, rules only:
1. Turn events into candidate steps: `navigate` → navigate step; text input → `fill`; select → `select`; checkbox → `check`; file → `upload`; click on a submit/next/send button → `click` with risk `commit`; masked OTP/CAPTCHA field → `userInput` with risk `auth`, `sensitive:true`.
2. **Locator synthesis** from the fingerprint, best first and 2–5 per step: `testid` > `id` (only if it doesn't look auto-generated, e.g. no long digit runs) > `name` > `label` > `role`+name > `text` (buttons) > `near` > `css` > `xpath`. **Verify uniqueness** against the step's DOM snapshot (load it with `linkedom` or Playwright `page.setContent`) and drop locators that match zero or many elements.
3. Default conditions: `pre` = `visible(locators)`; `post` for fill = `valueEquals` + `noErrorNear`; for commit clicks = `urlMatches(next page)` or `textPresent(next page heading)` from the next snapshot; for the final page = `extract` of the Application ID (regex `SSP-\d{4}-\d{6}`).
4. Risk and repair policy: `fill/read → repair:"auto"`, `commit/auth → repair:"human"`.

**Acceptance:** compiling your recording gives the same step count, actions and risk classes as the golden tool, and every locator resolves uniquely in its snapshot.

## Phase R4: Compiler, LLM pass + save → **C6** (Day 4–5)
**Depends on:** C4 (engine for the validation run), C5 (API), C5b (`@mcpify/llm`).

1. Use `parseJson` from `@mcpify/llm` (Claude Haiku 5.5, structured outputs) **once per recording** with: the task hint, the step list (field labels, actions, example values **with sensitive ones redacted**), and short DOM excerpts around each element (max ~1500 characters each). Zod output schema:
   ```ts
   { toolName: string, title: string, description: string,
     params: { stepId: string, paramName: string, label: string, type: "string"|"number"|"boolean"|"date"|"enum"|"file", enum?: string[], required: boolean, sensitive: boolean }[],
     steps: { stepId: string, intent: string, riskOverride?: "read"|"fill"|"commit"|"auth" }[],
     outputs: { name: string, description: string }[] }
   ```
   System prompt: you name parameters in snake_case from the field's meaning, write one clear intent sentence per step, never invent fields, mark identity/OTP/password fields sensitive, and say in the description that the tool pauses for confirmation and OTP.
2. Merge into the deterministic draft. Build `inputSchema` (JSON Schema) from the params; `enum` for selects comes from the recorded options.
3. **Validation run:** execute the draft with the engine (`@mcpify/engine/playwright`) on the live portal in **dry-run** with the recorded example values. All `fill` steps must pass up to the first `commit`. Attach the result to the draft.
4. Save via `POST /tools` (status `draft`). CLI: `pnpm --filter @mcpify/compiler compile --recording <file|id>`.
5. Tests: snapshot test against your saved Portal 1 recording; the LLM is mocked in unit tests; one live test behind `LIVE_LLM=1`.

**Acceptance:** recording → draft tool visible in the API (and in Sinchana's dashboard); after approval, Subhash's MCP server runs it end-to-end on Portal 1.
→ Mark **C6** ✅ (unblocks Sinchana recording Portals 2 and 3).

## Phase R5: Verified selective repair → **C12** (Day 5–7)
**Depends on:** C4, C5, C11 (Layout Lab mutations). Start the heuristics with a hand-mutated copy of the Portal 1 HTML before C11.

`packages/repair`, `repairStep({ tool, failedStepId, evidenceHtml, failedChecks, portalUrl }): Promise<RepairProposal>`:
1. **Freeze:** only the failed step is considered. Never touch other steps.
2. **Tier 1, locator fallback:** if any existing locator still uniquely resolves in the evidence DOM and the step's post-conditions would hold, propose the reordered locators (`method:"locator_fallback"`, confidence 0.9).
3. **Tier 2, heuristic re-match:** score every candidate element of the same kind (input/select/button) in the new DOM against the old fingerprint: label similarity (normalised Levenshtein / token overlap), name/id similarity, placeholder, nearText, position among siblings, and for buttons the text plus being in the same form. Take the best if score ≥ 0.75 and it clearly beats the runner-up (margin ≥ 0.15). Build fresh locators for it (same rules as R3) (`method:"heuristic"`).
4. **Tier 3, LLM:** if tiers 1–2 fail, call `parseJson` with the step intent, old fingerprint and a compact list of candidate elements (tag, label, id, name, text; max 40), asking for the index of the matching element or `none` plus a short reason (`method:"llm"`). For `select` option relabelling (M9), the LLM may also return an option-label mapping.
5. **Structural detection:** if the evidence page has new **required** fields that the tool doesn't fill, or the expected page no longer exists (M6, M8), return `status:"needs_rerecord"` without proposing.
6. **Sandbox test:** open a fresh Playwright context, replay the tool from the start up to and including the repaired step in **dry-run** (commit steps are blocked, so nothing is ever sent), using the recorded example inputs, and check the repaired step's postconditions. `sandbox.passed` = all checks hold.
7. `reversible = risk ∈ {read, fill}`. POST the proposal to `/repairs`; the API applies the auto-apply rule.
8. Hook it into Subhash's `RunManager.onStepFailed` (coordinate via `docs/requests/subhash.md`), so failed runs trigger repair automatically and the agent gets `status:"repair_pending"` or, after auto-apply, a retry.

Tests: for **each of M1–M10** (toggle via `/__lab/mutations`), assert the expected outcome from `apps/portals/MUTATIONS.md`. Save the results table to `packages/repair/RESULTS.md`; Subhash's benchmark reuses it.

**Acceptance:** M1, M2, M5, M9, M10 auto-repair and the rerun passes; M3 and M7 go to `pending` and pass after owner approval; M6 and M8 end as `needs_rerecord`; nothing is ever submitted during the sandbox test.
→ Mark **C12** ✅.

## Phase R6: Support recording (Day 8)
Help Sinchana record and compile the Portal 2 and 3 tools, and fix compiler issues they expose (logins, payment pages, uploads, date ranges). Add those recordings to the compiler's tests.
