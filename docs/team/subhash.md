# Subhash: foundation, API, MCP server, receipts, deployment, benchmarks

**Start Claude Code in the repo root and say:**
> I am Subhash. Read CLAUDE.md, then docs/00-ARCHITECTURE.md, docs/01-CONTRACTS.md, docs/02-PLAN-AND-SYNC.md, docs/STATUS.md and docs/team/subhash.md. Execute my plan phase by phase, following the waiting protocol. Before each phase, tell me what you're about to do.

You own: repo root config, `packages/contracts`, `packages/llm`, `packages/storage`, `apps/api`, `apps/mcp-server`, `bench/`, `infra/`, `docs/01-CONTRACTS.md`.
**You are the critical path on Day 1.** Everyone waits for C0, so ship it within about 2 hours.

---

## Phase S1: Repo scaffold → **C0** (Day 1, first)
**Depends on:** nothing.

Steps:
1. Root `package.json` (private, `"packageManager": "pnpm@9"`, scripts: `dev`, `build`, `typecheck` = `pnpm -r typecheck`, `test` = `pnpm -r test`, `format`), `pnpm-workspace.yaml` (`packages/*`, `apps/*`, `bench`), `tsconfig.base.json` (strict, ES2022, `moduleResolution: bundler`, `verbatimModuleSyntax`), `.prettierrc`, `.editorconfig`, `.nvmrc` (22).
2. `.gitignore`: `node_modules`, `dist`, `.env`, `.data`, `.next`, `playwright-report`, `test-results`, `bench/results/raw`, `*.local`.
3. `.env.example` exactly as in 00-ARCHITECTURE §5.
4. `docker-compose.yml` with Postgres 16 (user/pass/db `mcpify`, port 5432, named volume).
5. Create **empty but valid** workspace packages for every folder in 00-ARCHITECTURE §2. Each gets a `package.json` (`name: @mcpify/<x>`, `type: module`, scripts `typecheck`, `test`, `build`), a `tsconfig.json` extending the base, `src/index.ts` exporting nothing yet, and one trivial passing Vitest test. Apps also get a `dev` script placeholder.
6. `docs/requests/` with empty `subhash.md`, `sinchana.md`, `rohan.md`, `chaitanya.md`.
7. GitHub Actions `.github/workflows/ci.yml`: pnpm install, `pnpm -r typecheck`, `pnpm -r test` on push and PR.
8. `pnpm install`, `pnpm -r typecheck`, `pnpm -r test` all pass. Commit and push.

**Claude Code prompt (if you want to paste it):**
> Do Phase S1 from docs/team/subhash.md exactly. Create the pnpm monorepo scaffold with every package and app listed in docs/00-ARCHITECTURE.md §2 as an empty, typechecking, test-passing workspace package. Do not implement features yet. When done, verify, mark C0 ✅ in docs/STATUS.md, push, and print the checkpoint block.

**Acceptance:** fresh clone → `pnpm install && pnpm -r typecheck && pnpm -r test` passes; `docker compose up -d` starts Postgres; CI is green.
→ Mark **C0** ✅. Tell the team on your group chat: "C0 is done, pull now."

## Phase S2: Contracts → **C1** (Day 1)
**Depends on:** C0.

1. In `packages/contracts/src/`, implement **every** type from 01-CONTRACTS.md as Zod schemas with the same names (`RiskClassSchema`, `LocatorSchema`, `ConditionSchema`, `ActionSchema`, `StepContractSchema`, `ToolSchema`, `SiteSchema`, `RecordingSchema`, `RecordedEventSchema`, `ElementFingerprintSchema`, `StepTraceSchema`, `NeedSchema`, `RunSchema`, `ReceiptSchema`, `RepairProposalSchema`, `AuditEventSchema`, `ToolCallResultSchema`), and export inferred types (`type Tool = z.infer<typeof ToolSchema>`).
2. Refinements: `repair` must be `"human"` when `risk` is `commit` or `auth`; `Tool.name` matches `^[a-z][a-z0-9_]{1,40}$`; the MCP tool name helper `mcpToolName(site, tool)` returns `${slug}__${name}` and asserts the 64-char limit; step ids are unique within a tool.
3. Helpers: `canonicalJson(value)` (sorted keys, no whitespace), `redactInputs(tool, inputs)` (sensitive → `"•••"`), `buildPreview(tool, inputs)` (label from step intent, masked if sensitive).
4. Tests: valid and invalid examples for each schema, including a full sample tool (copy the `enter_annual_income` example from README.md).
5. Write `packages/contracts/README.md` with a usage example.

**Acceptance:** `pnpm --filter @mcpify/contracts test` passes; a sample Tool JSON round-trips through `ToolSchema.parse`.
→ Mark **C1** ✅.

## Phase S3: LLM + storage packages → **C5b** (Day 2)
**Depends on:** C1.

`packages/llm`:
- `getClaude()` returns a client for `LLM_PROVIDER`:
  - `bedrock`: `new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION })` from `@anthropic-ai/bedrock-sdk`, model `process.env.BEDROCK_MODEL_ID` (default `anthropic.claude-haiku-5-5`).
  - `anthropic`: `new Anthropic()` from `@anthropic-ai/sdk`, model `process.env.ANTHROPIC_MODEL_ID` (default `claude-haiku-5-5`).
- `MODEL` constant resolved from env.
- `parseJson<T>(schema: ZodType<T>, system: string, user: string, opts?)`: structured output via `client.messages.parse({ model, max_tokens: 16000, system, messages, output_config: { format: zodOutputFormat(schema), effort: "medium" } })` using `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. Guard `parsed_output` being null, check `stop_reason` (handle `refusal` and `max_tokens` with a typed error), and retry once on a schema failure. **Before writing this, check the current SDK docs** and confirm that structured outputs work through the Bedrock Mantle client; if they don't, fall back to strict tool use (`strict: true`, `tool_choice: auto`) and parse the tool input.
- `redactForLlm(text)`: strips anything that looks like an OTP, Aadhaar, phone number or email before sending.
- Log token usage (`usage.input_tokens`, `usage.output_tokens`) per call to stdout as JSON; benchmarks need it.
- Test: a mocked client test, plus an optional live test skipped unless `LIVE_LLM=1`.

`packages/storage`:
- `BlobStore` interface `put(content, mime) → blobId`, `get(blobId)`. Implementations: `FsBlobStore(BLOB_DIR)` (sha256 ids) and `S3BlobStore(S3_BUCKET)` behind the same interface.
- `Signer` interface `sign(bytes) → {signature, keyId}`, `verify(bytes, signature, keyId)`. Implementations: `LocalEd25519Signer` (key pair generated into `.data/keys/` on first use) and `KmsSigner(KMS_KEY_ID)` (AWS KMS `Sign`/`Verify`, ECDSA_SHA_256 or RSASSA_PSS; check the AWS SDK v3 docs).

**Acceptance:** unit tests pass; `parseJson` works live with your AWS credentials (`LIVE_LLM=1`).
→ Mark **C5b** ✅ and tell Rohan.

## Phase S4: API core → **C5** (Day 2–3)
**Depends on:** C1 (C5b for blobs).

1. `apps/api`: Fastify + `@fastify/cors` + Drizzle ORM (`postgres` driver). Tables: `sites`, `tools` (id, site_id, name, version, status, json jsonb, created_at; unique (id, version)), `recordings`, `runs`, `receipts`, `repairs`, `audit_events`. Use migrations via `drizzle-kit`.
2. Implement every endpoint in 01-CONTRACTS §11 **except** live execution (`POST /runs` and `/runs/:id/continue` come in S5). Validate bodies with the contract schemas. Write audit events for: tool created, approved, disabled, patched, run started/finished, repair created/approved/rejected.
3. `GET /sites/manifest?origin=` returns approved tools only; CORS open for this route (portals and the extension call it).
4. `POST /repairs`: apply the auto-apply rule from 01-CONTRACTS §10 (patch the tool → version+1 → audit).
5. Seed script `pnpm --filter @mcpify/api seed`: creates the 3 demo sites (origins 5101, 5102, 5103; slugs `scholarship`, `fees`, `buspass`) and loads `fixtures/tools/*.json` as approved tools if they exist.
6. Tests with Vitest + `fastify.inject` against a test database (or pg-mem).

**Acceptance:** `docker compose up -d && pnpm --filter @mcpify/api dev` → `/health` ok; seed works; curl examples in `apps/api/README.md` pass.
→ Mark **C5** ✅ (unblocks Sinchana's dashboard, Chaitanya's mcpify.js and Rohan's compiler/repair).

## Phase S5: RunManager + MCP server → **C7** (Day 4–5)
**Depends on:** C4 (engine), C5. **Stub allowed:** until C4 is ✅, write a fake `runTool` that walks the steps and emits the same pauses, so you can build the MCP layer now.

1. `RunManager` (in `apps/api/src/runs/`): `start(toolId, inputs, mode, dryRun)` launches Chromium (Playwright, one browser and one context per run), creates `createPlaywrightDriver(page)` and calls `runTool` with hooks where `onNeed` stores a resolver keyed by run id and **returns to the HTTP caller** with `status: awaiting_*`. `continue(runId, answer)` resolves it and waits for the next pause or terminal state. Persist the trace (redacted) after every step. Cancel runs idle for over 10 minutes.
2. Wire `POST /runs`, `POST /runs/:id/continue`, `POST /runs/:id/cancel`.
3. When a run fails a step, call `@mcpify/repair` (Rohan) if it is available; otherwise just mark `failed`. Rohan's C12 plugs in here. Leave a clearly named hook `onStepFailed(run, tool, evidence)`.
4. `apps/mcp-server`: `@modelcontextprotocol/sdk` `McpServer` with the **streamable HTTP** transport at `/mcp`. **Read the SDK's current README first.** `tools/list` is built from the API (approved tools, refreshed every 10 s or on change), plus `mcpify_continue`, `mcpify_get_run`, `mcpify_cancel`. Each call proxies to the API run endpoints and returns `ToolCallResult` JSON (01-CONTRACTS §12).
5. Test end-to-end with **MCP Inspector** (`npx @modelcontextprotocol/inspector`) against Portal 1 using the golden tool, then with Claude Code or Claude Desktop as a client.

**Acceptance:** from MCP Inspector, `scholarship__apply_scholarship` → `awaiting_confirmation` → continue → `awaiting_user_input` (OTP from `http://localhost:5101/phone`) → continue → `succeeded` with `application_id`; the application shows up in Portal 1's `/__lab/state`.
→ Mark **C7** ✅ (unblocks Sinchana's voice work after C18, and your benchmarks).

## Phase S6: Signed receipts → **C14** (Day 6)
**Depends on:** C5b, C7.
1. On `succeeded` runs that executed at least one `commit` step, auto-issue a receipt: summary = `buildPreview`, outputs, `traceHash = sha256(canonicalJson(trace))`, signed with `Signer` over `canonicalJson(receiptWithoutSignature)`.
2. `POST /receipts/verify` recomputes and verifies. Add a tamper test (change one output → invalid).
3. `SIGNER=kms` path tested once with a real KMS key (asymmetric, sign/verify).

**Acceptance:** valid receipt verifies; tampered receipt fails; MCP results include `receipt_id`.
→ Mark **C14** ✅.

## Phase S7: Public deployment → **C18** (Day 6)
**Depends on:** C7.
Goal: an HTTPS MCP URL for ElevenLabs, plus a public demo.
- Fastest reliable path: one AWS EC2 (or Render) box running `docker compose` for api, mcp-server, portals and dashboard, with Caddy for TLS on your `.xyz` domain (`api.`, `mcp.`, `scholarship.`, `fees.`, `buspass.`, `app.` subdomains). Optional: ECS Fargate if time allows.
- Write `infra/README.md` with exact commands. Put the public MCP URL in `.env.example` as a comment and in STATUS notes.
- Fallback for local demos: `cloudflared tunnel --url http://localhost:4100`.

**Acceptance:** `https://mcp.<domain>/mcp` works from MCP Inspector over the internet.
→ Mark **C18** ✅ and tell Sinchana.

## Phase S8: Agent proxy + hardening (Day 7)
- `POST /agent/step`: proxy to Claude Haiku 5.5 through `@mcpify/llm` (messages + tools in, Message out). Rate-limit it (e.g. 30/min per IP) and cap `max_tokens`. Used by Chaitanya's extension panel.
- Make sure no OTP or password ever appears in the DB, logs or traces: write a test that runs the golden tool and greps the stored run and logs for the OTP value.

## Phase S9: Benchmarks → **C16** (Day 8)
**Depends on:** C7, C15.
1. `bench/run.ts`: for each flow (Portal 1 apply, Portal 2 pay-fee dry-run, Portal 3 renew), run **MCPify via the MCP client** N=20 times (OTP read from `/__lab/otp`, confirmations auto-approved by the bench user), resetting the portal each time with `/__lab/reset`.
2. Baseline: a **computer-use style agent** doing the same task with screenshots. Use Claude with the computer-use toolset driving a Playwright browser, or an open-source browser agent with Claude. **Check the current docs** for the right computer-use tool version for the model you pick, and record which you used.
3. Measure per run: wall time, number of model calls, input/output tokens, success (verified via `/__lab/state` that exactly one correct application exists), human interventions.
4. Repair benchmark: for each mutation M1–M10, run the tool, let repair act, record outcome (auto-repaired / stopped safely / wrong) and time to repair.
5. Write `bench/results/summary.json` and `bench/results/summary.md` (tables with mean, p50, p95, success rate). **Only report what was measured.**

**Acceptance:** summary files exist with real numbers for all three flows and all 10 mutations.
→ Mark **C16** ✅.

## Phase S10: Integration freeze → **C19** (Day 9)
Run the full demo script in 02-PLAN-AND-SYNC §6 with everyone. Log every failure in `docs/requests/<owner>.md`. When it passes twice in a row, mark **C19** ✅.
