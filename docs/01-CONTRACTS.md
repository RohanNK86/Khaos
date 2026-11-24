# 01 · Contracts (single source of truth)

Everything shared between people is defined here. `packages/contracts` (Subhash, checkpoint **C1**) implements these as Zod schemas **with exactly these names and fields**. Until C1 lands, other sessions may copy the types below into a local `src/contracts-stub.ts` and switch to `@mcpify/contracts` once it is ✅.

Only Subhash edits this file. Version: **v1.1** (additions in §15).

---

## 1. Core enums
```ts
type RiskClass = "read" | "fill" | "commit" | "auth";
//  read   – only reads the page                       → runs freely
//  fill   – types/selects, sends nothing              → runs; auto-repair allowed
//  commit – clicks that SEND data (Next, Save, Submit, Send OTP)
//                                                     → needs user confirmation; never auto-repaired
//  auth   – login, OTP, CAPTCHA, payment              → human provides/approves; never auto-repaired

type RepairPolicy = "auto" | "human";   // "auto" is only legal for read/fill steps
type ToolStatus   = "draft" | "approved" | "disabled";
type RunMode      = "owner" | "user";   // owner = official script tag / server; user = extension in user's tab
type RunStatus =
  | "running" | "awaiting_confirmation" | "awaiting_user_input"
  | "succeeded" | "failed" | "repair_pending" | "stopped" | "dry_run_complete";
```

## 2. Locators
Every interactive step carries **2–5 locators**, ordered best-first. The engine tries them in order; a locator "resolves" only if it matches **exactly one visible element**.
```ts
type Locator =
  | { kind: "testid"; value: string }        // data-testid / data-mcpify
  | { kind: "id";     value: string }        // element id
  | { kind: "name";   value: string }        // name attribute
  | { kind: "label";  value: string }        // visible <label> text (normalised, case-insensitive)
  | { kind: "role";   role: string; name: string }  // ARIA role + accessible name
  | { kind: "text";   value: string }        // exact visible text (buttons/links)
  | { kind: "css";    value: string }
  | { kind: "near";   anchorText: string; tag: string }  // first <tag> after visible anchorText
  | { kind: "xpath";  value: string };       // last resort
```

## 3. Conditions (pre and post): deterministic, never LLM
```ts
type Condition =
  | { kind: "visible";      locators: Locator[] }
  | { kind: "hidden";       locators: Locator[] }
  | { kind: "valueEquals";  locators: Locator[]; param: string }   // field now holds input[param]
  | { kind: "textPresent";  text: string }                          // anywhere on page
  | { kind: "textAbsent";   text: string }
  | { kind: "urlMatches";   pattern: string }                       // JS RegExp source
  | { kind: "noErrorNear";  locators: Locator[] }                   // no .error/[role=alert] next to element
  | { kind: "extract";      locators: Locator[]; as: string; pattern?: string }  // read text → outputs[as]
```

## 4. Actions
```ts
type Action =
  | { type: "navigate"; url: string }
  | { type: "fill";     param: string }          // value = inputs[param]
  | { type: "select";   param: string }          // option by visible label, then by value
  | { type: "check";    param: string }          // boolean param
  | { type: "click" }
  | { type: "upload";   param: string }          // param holds a file reference (blob id)
  | { type: "userInput"; param: string; prompt: string }   // OTP/CAPTCHA – value comes from the human
  | { type: "waitFor";  condition: Condition }
  | { type: "extract" };                          // no-op action; work is done in post "extract"
```

## 5. Semantic Step Contract
```ts
interface StepContract {
  id: string;                 // stable, snake_case, unique in tool: "enter_annual_income"
  intent: string;             // human sentence: "Fill the applicant's annual family income"
  action: Action;
  locators: Locator[];        // empty only for navigate / waitFor / extract-only steps
  pre: Condition[];           // all must pass before acting
  post: Condition[];          // all must pass after acting (within timeoutMs)
  risk: RiskClass;
  repair: RepairPolicy;       // must be "human" when risk is commit or auth
  sensitive?: boolean;        // value never logged, never sent to LLM (passwords, OTP, Aadhaar)
  timeoutMs?: number;         // default 8000
}
```

## 6. Tool
```ts
interface Tool {
  id: string;                 // uuid
  siteId: string;             // see Site
  name: string;               // snake_case, unique per site: "apply_scholarship"
  title: string;              // "Apply for State Scholarship"
  description: string;        // what an agent should know; mentions OTP/confirmation if any
  version: number;            // starts at 1; repair patches create version+1
  status: ToolStatus;
  inputSchema: JSONSchema;    // JSON Schema (draft 2020-12) for inputs; `required` filled in
  outputs: string[];          // names produced by "extract" conditions: ["application_id"]
  startUrl: string;
  steps: StepContract[];
  createdFrom?: string;       // recording id
  createdAt: string;          // ISO
  updatedAt: string;
}

interface Site {
  id: string;                 // uuid
  origin: string;             // "http://localhost:5101"
  slug: string;               // "scholarship"  (used in MCP tool names)
  name: string;               // "State Scholarship Portal (DEMO)"
  mode: "owner" | "user_only";// owner = site embeds mcpify.js
}
```
**MCP tool name** = `${site.slug}__${tool.name}` (example: `scholarship__apply_scholarship`), matching `^[a-zA-Z0-9_-]{1,64}$`.

## 7. Recording (recorder → compiler)
```ts
interface Recording {
  id: string;
  siteOrigin: string;
  startUrl: string;
  taskName: string;           // human hint: "apply_scholarship"
  events: RecordedEvent[];
  createdAt: string;
}
interface RecordedEvent {
  seq: number;
  t: number;                  // ms since start
  type: "navigate" | "click" | "input" | "change" | "submit" | "keydown_enter";
  url: string;                // page URL when event fired
  target?: ElementFingerprint;
  value?: string;             // typed/selected value (masked "•••" if input type=password)
  domSnapshotBlobId?: string; // full HTML after the event (stored via @mcpify/storage)
}
interface ElementFingerprint {
  tag: string; type?: string; id?: string; name?: string; testid?: string;
  classes: string[]; label?: string; ariaLabel?: string; role?: string;
  text?: string; placeholder?: string; nearText?: string;
  cssPath: string; xpath: string;
  options?: { value: string; label: string }[];   // for <select>
  inForm?: string;            // form id/name/action
}
```

## 8. Runs, traces, needs
```ts
interface StepTrace {
  stepId: string;
  status: "passed" | "failed" | "skipped" | "blocked_dry_run" | "awaiting";
  usedLocator?: Locator;      // which locator resolved
  preResults: { ok: boolean; detail?: string }[];
  postResults: { ok: boolean; detail?: string }[];
  startedAt: string; durationMs: number;
  error?: string;
  evidenceBlobId?: string;    // DOM snapshot on failure
}

type Need =
  | { kind: "confirmation"; stepId: string; preview: { label: string; value: string }[] }
  | { kind: "user_input";   stepId: string; param: string; prompt: string; sensitive: boolean };

interface Run {
  id: string;                 // uuid
  toolId: string; toolVersion: number;
  mode: RunMode;
  dryRun: boolean;
  status: RunStatus;
  need?: Need;                // present iff status is awaiting_*
  inputsRedacted: Record<string, string>;   // sensitive values replaced with "•••"
  outputs: Record<string, string>;
  trace: StepTrace[];
  failedStepId?: string;
  receiptId?: string;
  startedAt: string; endedAt?: string;
}
```

## 9. Receipts
```ts
interface Receipt {
  id: string;
  runId: string; toolId: string; toolVersion: number;
  siteOrigin: string;
  summary: { label: string; value: string }[];   // redacted submitted fields
  outputs: Record<string, string>;               // e.g. { application_id: "SSP-2026-000123" }
  traceHash: string;                             // sha256 of canonical JSON of the trace
  issuedAt: string;
  signature: string;                             // base64
  keyId: string;                                 // "local-ed25519-1" or KMS key ARN
}
// Signed payload = canonical JSON (sorted keys) of the receipt WITHOUT signature.
```

## 10. Repair
```ts
interface RepairProposal {
  id: string;
  toolId: string; fromVersion: number;
  stepId: string;
  reason: string;                          // which checks failed
  evidence: { domSnapshotBlobId: string; failedChecks: string[]; screenshotBlobId?: string };
  proposedStep: StepContract;              // replacement for stepId
  method: "locator_fallback" | "heuristic" | "llm";
  confidence: number;                      // 0..1
  sandbox: { passed: boolean; detail: string };
  reversible: boolean;                     // true only for read/fill steps
  status: "pending" | "auto_applied" | "approved" | "rejected" | "needs_rerecord";
  createdAt: string;
}
```
**Auto-apply rule:** `risk ∈ {read, fill}` AND `sandbox.passed` AND `confidence ≥ 0.8` → `auto_applied` (tool version + 1). Otherwise `pending` (owner decides). A structural change (new required field, page split) → `needs_rerecord`.

---

## 11. HTTP API (`apps/api`, base `http://localhost:4000`)
All bodies are JSON and validated with the schemas above. Errors use `{ error: string, details?: unknown }` with a proper status code.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/health` | → `{ ok: true }` |
| POST | `/sites` | `Omit<Site,"id">` → `Site` (upsert by origin) |
| GET | `/sites` | → `Site[]` |
| GET | `/sites/manifest?origin=<origin>` | → `{ site: Site, tools: Tool[] }` (approved only) |
| POST | `/recordings` | `Recording` → `{ id }` |
| GET | `/recordings/:id` | → `Recording` |
| POST | `/tools` | `Omit<Tool,"id"|"createdAt"|"updatedAt"|"version"|"status">` → `Tool` (status `draft`, version 1) |
| GET | `/tools?siteId=&status=` | → `Tool[]` (latest version of each) |
| GET | `/tools/:id` | → `Tool` (latest) ; `/tools/:id/versions/:v` → that version |
| POST | `/tools/:id/approve` | → `Tool` |
| POST | `/tools/:id/disable` | → `Tool` |
| POST | `/tools/:id/patch` | `{ stepId, step: StepContract, reason }` → `Tool` (version+1, keeps status) |
| POST | `/runs` | `{ toolId, inputs, mode, dryRun }` → `Run` (server-side execution, owner mode) |
| GET | `/runs/:id` | → `Run` |
| POST | `/runs/:id/continue` | `{ approve?: boolean, value?: string }` → `Run` (after it reaches the next pause/terminal) |
| POST | `/runs/:id/cancel` | → `Run` |
| POST | `/runs/report` | `Run` (client-side runs from extension/mcpify.js report their final trace) → `{ id }` |
| GET | `/runs?toolId=&limit=` | → `Run[]` |
| POST | `/receipts/issue` | `{ runId }` → `Receipt` (only for succeeded runs with a commit step) |
| GET | `/receipts/:id` | → `Receipt` |
| POST | `/receipts/verify` | `Receipt` → `{ valid: boolean }` |
| GET | `/audit?siteId=&limit=` | → `AuditEvent[]` where `AuditEvent = { id, at, siteId, toolId?, runId?, actor: "agent"|"user"|"owner"|"system", action: string, detail?: string }` |
| POST | `/repairs` | `Omit<RepairProposal,"id"|"createdAt">` → `RepairProposal` (API applies the auto-apply rule) |
| GET | `/repairs?status=` | → `RepairProposal[]` |
| POST | `/repairs/:id/approve` | → `{ proposal, tool }` (tool patched, version+1) |
| POST | `/repairs/:id/reject` | → `RepairProposal` |
| POST | `/blobs` | raw body (`content-type` kept) → `{ blobId }` |
| GET | `/blobs/:blobId` | → raw |
| POST | `/agent/step` | `{ messages, tools }` (Anthropic Messages shapes) → Anthropic `Message`. Thin proxy so browser clients never hold API keys. |

## 12. MCP server (`apps/mcp-server`, `http://localhost:4100/mcp`, streamable HTTP)
- On each `tools/list`, the server lists every **approved** tool as `${site.slug}__${tool.name}` with `inputSchema` = `tool.inputSchema` and description = `tool.description` + a fixed suffix explaining confirmation/OTP pauses.
- Plus three fixed tools:
  - `mcpify_continue({ run_id: string, approve?: boolean, value?: string })`: answers the current `need`.
  - `mcpify_get_run({ run_id })`: returns the run status.
  - `mcpify_cancel({ run_id })`.
- **Every** tool result is one text content block containing JSON:
```ts
interface ToolCallResult {
  run_id: string;
  status: RunStatus;
  message: string;                 // one plain sentence the agent can say to the user
  need?: Need;                     // when awaiting_*
  outputs?: Record<string, string>;
  receipt_id?: string;
  error?: string;
}
```
- A call returns as soon as the run reaches a pause (`awaiting_*`) or a terminal state. Runs left waiting for over 10 minutes are cancelled.

## 13. Engine API (`@mcpify/engine`)
```ts
interface Driver {
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  resolve(locators: Locator[]): Promise<{ handle: ElementRef; used: Locator } | null>; // exactly one visible match
  fill(el: ElementRef, value: string): Promise<void>;
  select(el: ElementRef, labelOrValue: string): Promise<void>;
  check(el: ElementRef, on: boolean): Promise<void>;
  click(el: ElementRef): Promise<void>;
  upload(el: ElementRef, file: { name: string; mime: string; bytes: Uint8Array }): Promise<void>;
  value(el: ElementRef): Promise<string>;
  text(el: ElementRef): Promise<string>;
  isVisible(locators: Locator[]): Promise<boolean>;
  pageText(): Promise<string>;
  hasErrorNear(el: ElementRef): Promise<boolean>;
  snapshot(): Promise<string>;              // full HTML
  waitForSettled(timeoutMs: number): Promise<void>;
}
type ElementRef = unknown;                  // driver-specific handle

interface RunHooks {
  onNeed(need: Need): Promise<{ approve?: boolean; value?: string }>;   // resolves when human answers
  onStep?(trace: StepTrace): void;          // live progress
  saveBlob?(content: string, mime: string): Promise<string>;  // for evidence
}
interface RunOptions { dryRun: boolean; mode: RunMode; startIndex?: number; signal?: AbortSignal }

function runTool(tool: Tool, inputs: Record<string, unknown>, driver: Driver,
                 hooks: RunHooks, opts: RunOptions): Promise<Run>;
```
Entry points: `@mcpify/engine` (core, no Node or DOM imports), `@mcpify/engine/playwright` (`createPlaywrightDriver(page)`), `@mcpify/engine/dom` (`createDomDriver(document)`).

**Engine semantics**
1. For each step from `startIndex`: evaluate `pre` (retry until `timeoutMs`). If they fail, the step fails.
2. `commit` step: if `dryRun`, mark `blocked_dry_run` and finish with `dry_run_complete`. Otherwise call `onNeed({kind:"confirmation", preview})` (preview = every filled param with its label, sensitive values masked). `approve:false` → status `stopped`.
3. `auth` step with `userInput` action → `onNeed({kind:"user_input", ...})`, then fill the returned value (never stored).
4. Execute the action through the first locator that resolves; record `usedLocator`.
5. Evaluate `post` (retry until `timeoutMs`). `extract` conditions write `outputs`.
6. If no locator resolves or any check fails: save `snapshot()` as evidence and end the run with `status:"failed"`, `failedStepId`. (The caller decides whether to start repair.)
7. A `commit` step never executes twice in one run.

## 14. Demo portal test hooks (`apps/portals`, owned by Sinchana)
Each portal exposes (only when `LAB_TOKEN` header `x-lab-token` matches):
- `GET  /__lab/state` → `{ mutations: string[], applications: object[] }`
- `POST /__lab/mutations` `{ enable: string[], disable: string[] }`. Mutation ids `M1`–`M10` (see sinchana.md).
- `POST /__lab/reset` → clears applications, mutations, OTPs.
- `GET  /__lab/otp?session=<id>` → latest OTP (for automated benchmarks only; humans use `/phone`).
Every interactive element also gets a stable `data-mcpify="<name>"` attribute in owner mode (`?owner=1` or env `OWNER_MODE=1`). Without it, pages look like untouched legacy HTML.

## 15. Additions in v1.1 (25 Nov, demo sprint)
- **Risk guidance:** a button that only moves between pages of a draft (portal keeps the data server-side, nothing is final) is `fill`. Anything with an external effect (send OTP, submit, pay, save permanently) is `commit`.
- **Input schema:** properties may carry `title` (used as the preview label) and `sensitive: true`. Upload params are plain file names from the MCPify file store (`fixtures/files/` for the demo).
- **Engine (§13):** `Driver.errors?(): Promise<string[]>` (visible validation messages, quoted in failures); `RunHooks.loadFile?(ref)` for uploads; `RunOptions.runId?` and `RunOptions.committedStepIds?` (idempotency on resume). Entry points also include `@mcpify/engine/network-guard` (`installNetworkGuard(ctx)`: aborts every non-GET request) and `@mcpify/engine/in-page` (the plain-JS resolver).
- **MCP (§12):** every site tool accepts `mcpify_dry_run: boolean`; sites with `mode: "user_only"` are always dry-run and get the network guard. Fourth fixed tool: `mcpify_verify_receipt({ receipt_id })` → `{ valid, ... }`.
- **Until the API exists**, approved tools are JSON files: `fixtures/tools/*.json` and `.data/tools/approved/*.json`; sites in `fixtures/sites.json`.
- **Portal hooks (§14):** `GET /__lab/captcha?session=<id>`; `session=latest` means the session that last opened page 3 (tests only).
