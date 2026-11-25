# @mcpify/repair: Verified Selective Repair (C12)

When a tool step fails because the site's layout changed, `repairStep` proposes a replacement for **that one step only**,
checks it in a dry-run sandbox, and decides whether it may be applied automatically (01-CONTRACTS §10).

## Pipeline (`repairStep`)
1. **Freeze**: only `failedStepId` changes. `id`, `intent`, `action`, `risk`, `repair`, `sensitive`, `timeoutMs` are kept; only `locators` and the `pre`/`post` conditions that pointed at the old element are rewritten.
2. The evidence HTML is loaded into an **offline** Playwright page (scripts stripped, every request aborted, stale `data-mcpify-ref` removed). Locators are resolved with the engine's own `IN_PAGE_JS`, so "unique" means exactly what it means to the engine.
3. **Tier 1, locator fallback** (`locator_fallback`, confidence 0.9): an existing locator still resolves to exactly one visible element → keep the locators that agree, put them first, drop any that point at a different element.
4. **Tier 2, heuristic re-match** (`heuristic`): the old signature comes from the step itself (label/role/text values, id/name/testid, near anchors, intent + step id + param words). Every same-kind candidate (text input / select / checkbox / file / button / link) is scored: label similarity 0.40 (normalised Levenshtein or fuzzy token overlap with synonyms and shared stems, e.g. "annual" ~ "annum", "next" ~ "continue"), id/name similarity 0.25 (legacy prefixes like `ctl00_ContentPlaceHolder1_txt` ignored), intent coverage 0.25, near text 0.10, and for buttons "same form as the previous step" 0.20. The best score must be at least 0.75 and beat the runner-up by at least 0.15. Fresh locators (testid > id > name > label > role > text) are each checked as unique, with 1 to 5 kept. An old `testid` is kept first when the evidence page has no testids at all (a legacy, non-owner render), because there is no way to check it on that page.
5. **Tier 3, LLM** (`llm`): only if `llmAvailable()` and the step is not sensitive. `parseJson` gets the intent, the old signature and up to 40 value-free candidates (passed through `redactForLlm`) and returns `{ index | -1, reason }`. LLM picks get confidence 0.75 if they agree with the heuristic's top candidate and 0.6 otherwise, so they always stay **pending** for owner review.
6. **Structural detection** gives `needs_rerecord` and leaves the step unchanged when (a) the page has a required input (`required`, `aria-required`, or a `*` in its label cell) that no tool step resolves to, other than the re-matched element (M8), or (b) nothing on the page looks like the step's element (best score below 0.5): the element moved to another page (M6).
7. **Sandbox**: a fresh headless context replays the patched tool from the start through the repaired step with `runTool(..., { dryRun: true })`. Commit steps are blocked by the engine, and auth prompts are never answered. The network guard is **not** installed, because the demo portal's draft "Next" is a POST that dry-run must allow. `sandbox.passed` means the repaired step passed its pre- and postconditions.
8. **Status**: `auto_applied` only if `risk ∈ {read, fill}`, `repair === "auto"`, `sandbox.passed`, `confidence ≥ 0.8` and no option mapping is needed. `needs_rerecord` for structural changes. `pending` otherwise. The API applies the same rule again.

### Select options relabelled (M9)
`StepContract` has no field for an option mapping, so a step on its own cannot carry one. When the element still matches but the tool's known option labels (input-schema `enum` + example value) are gone, the repair maps each old label to its new label. Abbreviation-aware matching turns `B.Sc` into `Bachelor of Science`. It then:
- keeps the step unchanged (locators reordered at most), method `heuristic`, confidence = min(0.9, weakest mapping score);
- appends the mapping to `reason` in machine-readable form: `… option-aliases: {"course":{"B.Sc":"Bachelor of Science",…}}`;
- runs the sandbox with translated inputs (`passed` when that works);
- returns **`pending`**, because a stored tool cannot apply the mapping by itself.

`optionAliases(proposal)` reads the mapping and `applyOptionAliases(inputs, aliases)` translates an agent's inputs. To make M9 auto-repairable, the contract would need e.g. `{ type: "select", param, optionAliases?: Record<string,string> }` (a request for Subhash).

## API
```ts
repairStep(args: {
  tool: Tool; failedStepId: string; evidenceHtml: string; failedChecks: string[];
  evidenceBlobId?: string; portalUrl?: string;          // portalUrl: sandbox against another origin
  sandbox?: { inputs; loadFile?; browser? };            // no sandbox → never auto_applied
  browser?: Browser;                                    // else a headless Chromium is launched + closed
}): Promise<Omit<RepairProposal, "id" | "createdAt">>

applyProposal(tool, proposal): Tool                     // version + 1, updatedAt; throws if stale/foreign
failedChecksFromRun(run): string[]
repairAndRetry({ run, tool, evidenceHtml, inputs, loadFile?, browser?, portalUrl?, retry? })
  : Promise<{ proposal; patched?: Tool; retried?: Run }>
optionAliases(proposal) / applyOptionAliases(inputs, aliases)
```

### Wiring into RunManager (`apps/mcp-server`)
```ts
// in RunManager, when runTool returns status "failed":
async onStepFailed(run, tool, evidence /* HTML of run.trace[failed].evidenceBlobId */) {
  const { proposal, patched, retried } = await repairAndRetry({
    run, tool, evidenceHtml: evidence, inputs /* unredacted, server-side */, loadFile, browser: this.browser,
    // resume in the SAME page from the failed step: earlier steps already passed there
    retry: (patched, startIndex) => runTool(patched, inputs, driver, hooks, { ...opts, startIndex, runId: run.id, committedStepIds }),
  });
  await POST("/repairs", proposal);            // the API re-applies the auto-apply rule and versions the tool
  if (!patched) run.status = "repair_pending"; // pending / needs_rerecord: the owner decides in the dashboard
  return retried ?? run;
}
```
Never call it for user-mode runs on third-party sites without dry-run, and never auto-retry after a step with an external effect.

## Tests
`pnpm --filter @mcpify/repair test` runs unit tests (similarity, option aliases, tier 3 with a mocked Claude client, tier 3 skipped without credentials) and the Layout Lab suite (`tests/mutations.test.ts`). That suite runs Portal 1 on a random port, toggles M1 to M10, runs the golden tool, repairs, reruns, and writes **`RESULTS.md`**. Every repair asserts that `/__lab/state` gained no applications.
