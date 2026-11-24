# 00 · Architecture

MCPify turns a task on a legacy website into **verified tools** that AI agents can call. See the root `README.md` for the pitch; this file is the engineering map.

## 1. The three layers
```
01 LEARN + COMPILE (once per task)
   recorder ──► Recording ──► compiler (rules + Claude Haiku 5.5) ──► Tool { StepContract[] } ──► registry (API, Postgres)

02 VERIFIED EXECUTION (every call)
   agent (Claude / ElevenLabs / extension panel)
     ├─ remote:   MCP server ──► RunManager ──► engine + PlaywrightDriver ──► website
     └─ in page:  mcpify.js / extension ──► engine + DomDriver (user's own tab) ──► website
   engine runs each step: CHECK pre ─► EXECUTE action ─► VERIFY post; pauses for auth/commit steps

03 VERIFIED SELECTIVE REPAIR (only when a step's checks fail)
   failed step + evidence ──► repair (heuristics, then LLM) ──► sandbox replay ──► verified + reversible?
       yes ─► versioned patch (tool v+1)     no ─► stop, owner reviews in dashboard
```

## 2. Repo layout
```
MCPify/
├─ CLAUDE.md                     rules for every Claude Code session
├─ README.md                     pitch + overview
├─ docs/                         these guides, STATUS board, requests
├─ package.json, pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml, .env.example
├─ packages/
│  ├─ contracts/    @mcpify/contracts    Zod schemas + types (Subhash)
│  ├─ llm/          @mcpify/llm          Claude client factory (Subhash)
│  ├─ storage/      @mcpify/storage      blob store + receipt signer (Subhash)
│  ├─ engine/       @mcpify/engine       verified engine + drivers (Chaitanya)
│  ├─ compiler/     @mcpify/compiler     Recording → Tool (Rohan)
│  ├─ repair/       @mcpify/repair       selective repair (Rohan)
│  └─ agent-ready/  @mcpify/agent-ready  the one script tag: mcpify.js (Chaitanya)
├─ apps/
│  ├─ api/          @mcpify/api          Fastify + Postgres registry, runs, receipts (Subhash)
│  ├─ mcp-server/   @mcpify/mcp-server   remote MCP server, streamable HTTP (Subhash)
│  ├─ recorder/     @mcpify/recorder     Playwright recording CLI (Rohan)
│  ├─ portals/      @mcpify/portals      3 demo portals + Layout Lab (Sinchana)
│  ├─ dashboard/    @mcpify/dashboard    owner dashboard, Next.js (Sinchana)
│  ├─ voice/        @mcpify/voice        ElevenLabs voice client page (Sinchana)
│  └─ extension/    @mcpify/extension    Chrome MV3 extension, user mode (Chaitanya)
├─ fixtures/tools/                       hand-written golden tools (Chaitanya)
├─ bench/                                benchmarks (Subhash)
└─ infra/                                deployment (Subhash)
```

## 3. Local ports
| Service | Port | Owner |
|---|---|---|
| Dashboard | 3000 | Sinchana |
| Voice client page | 3100 | Sinchana |
| API | 4000 | Subhash |
| MCP server (`/mcp`) | 4100 | Subhash |
| Portal 1: State Scholarship Portal (DEMO) | 5101 | Sinchana |
| Portal 2: University Fee Portal (DEMO) | 5102 | Sinchana |
| Portal 3: Student Bus Pass Portal (DEMO) | 5103 | Sinchana |
| Postgres (docker) | 5432 | Subhash |

## 4. Tech stack
| Concern | Choice |
|---|---|
| Language / tooling | TypeScript (strict, ESM), Node 22, pnpm workspaces, Vitest, tsx, Prettier |
| Schemas | Zod (`@mcpify/contracts`) |
| Browser automation | Playwright (recorder, server-side driver, sandbox repair) |
| LLM | Claude Haiku 5.5 via Amazon Bedrock (`anthropic.claude-haiku-5-5`) or the Claude API (`claude-haiku-5-5`) through `@mcpify/llm` |
| API | Fastify + Drizzle ORM + PostgreSQL |
| MCP | `@modelcontextprotocol/sdk` (TypeScript), streamable HTTP transport |
| In-page tools | WebMCP (`navigator.modelContext`), with the MCP-B polyfill where the browser lacks it |
| Dashboard | Next.js (App Router) + Tailwind; MCPify visual style: cream `#F8F2E4`, ink `#1A1A1A`, orange `#FD9B36` |
| Extension | Chrome Manifest V3, side panel, `declarativeNetRequest` for dry-run |
| Voice | ElevenLabs Agents connected to our MCP server (Sarvam as fallback for Kannada if needed) |
| Cloud | AWS: Bedrock, Fargate (or a single EC2/Render box for the demo), RDS, S3, KMS; `.xyz` domain |

## 5. Environment variables (`.env.example`, owned by Subhash)
```
DATABASE_URL=postgres://mcpify:mcpify@localhost:5432/mcpify
API_URL=http://localhost:4000
MCP_URL=http://localhost:4100/mcp
LLM_PROVIDER=bedrock              # bedrock | anthropic
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-haiku-5-5
ANTHROPIC_MODEL_ID=claude-haiku-5-5
ANTHROPIC_API_KEY=                # only if LLM_PROVIDER=anthropic
BLOB_DIR=./.data/blobs            # local blob store; S3 in prod
S3_BUCKET=
SIGNER=local                      # local | kms
KMS_KEY_ID=
LAB_TOKEN=changeme                # Layout Lab admin token for demo portals
ELEVENLABS_AGENT_ID=
PUBLIC_MCP_URL=                   # https URL of the MCP server for ElevenLabs
```

## 6. One run, end to end (owner mode, remote agent)
1. ElevenLabs agent calls MCP tool `scholarship__apply_scholarship({name, course, annual_income, ...})`.
2. MCP server → `RunManager.start(tool, inputs)` → engine with a fresh Playwright context on Portal 1.
3. Engine fills steps (`fill`), reaches `Send OTP` (`commit`) → asks for confirmation; the tool call returns `status: awaiting_confirmation` with a preview.
4. Agent reads the preview to the user, the user agrees, and the agent calls `mcpify_continue({run_id, approve: true})`.
5. Engine reaches the OTP field (`auth`), returns `status: awaiting_user_input`; the user says the OTP and the agent calls `mcpify_continue({run_id, value: "482913"})`.
6. Final `Submit` (`commit`) → confirmation again → submitted → postcondition "Application ID visible" passes.
7. API stores the trace (redacted) and issues a **signed receipt**; the tool result returns `status: succeeded` with outputs `{application_id}` and the `receipt_id`.
