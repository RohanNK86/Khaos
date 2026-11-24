# CLAUDE.md: rules for every Claude Code session in this repo

You are one of **four parallel Claude Code sessions** building MCPify, each driven by a different teammate. Read this file fully before doing anything.

## 1. Who you are working for
Your human tells you their name in the first message ("I am Rohan", for example). Your work plan is `docs/team/<name>.md` (`subhash.md`, `sinchana.md`, `rohan.md` or `chaitanya.md`). Execute it **phase by phase, in order**. If the human did not say who they are, ask before writing any code.

## 2. Required reading (in this order)
1. `docs/00-ARCHITECTURE.md`: what we are building, repo layout, ports, who owns which folder.
2. `docs/01-CONTRACTS.md`: **the single source of truth** for shared types, HTTP APIs, MCP tool shapes and run states. Never invent a field that is not in it.
3. `docs/02-PLAN-AND-SYNC.md`: checkpoints, dependencies, and the waiting protocol.
4. `docs/STATUS.md`: the live checkpoint board.
5. Your own `docs/team/<name>.md`.

## 3. Ownership: never edit another person's folders
| Owner | Folders they own |
|---|---|
| Subhash | repo root config, `packages/contracts`, `packages/llm`, `packages/storage`, `apps/api`, `apps/mcp-server`, `bench/`, `infra/`, `docs/01-CONTRACTS.md` |
| Sinchana | `apps/portals`, `apps/dashboard`, `apps/voice` |
| Rohan | `apps/recorder`, `packages/compiler`, `packages/repair` |
| Chaitanya | `packages/engine`, `apps/extension`, `packages/agent-ready`, `fixtures/tools` |

- Other people's packages may be **imported**, never edited. If you need a change in someone else's package, write it as an issue in `docs/requests/<owner>.md` (append a dated bullet), tell your human, and continue with a local stub.
- Only **Subhash** edits `docs/01-CONTRACTS.md`. If a contract must change, append a proposal to `docs/requests/subhash.md` and tell your human.
- Every person may edit **only their own rows** in `docs/STATUS.md`.

## 4. Git workflow (everyone pushes to `main`)
- Before starting any phase: `git pull --rebase origin main`.
- Commit small and often, with the prefix `[<name>] <area>: <what>` (example: `[rohan] compiler: add locator synthesis`).
- Before pushing: run `pnpm -r typecheck` and the tests of the packages you touched. Never push a broken build to `main`.
- `pnpm-lock.yaml` conflict: accept the incoming version (`git checkout --theirs pnpm-lock.yaml`), run `pnpm install`, then commit the result.
- Never commit secrets. `.env` is git-ignored; add new variables to `.env.example` with a dummy value. Never commit real people's personal data.
- Never force-push to `main`.

## 5. The waiting protocol (very important)
Each phase in a team doc lists the checkpoints it **depends on**. Before starting a phase:
1. `git pull --rebase origin main`, then read `docs/STATUS.md`.
2. If every dependency is ✅, start.
3. If any dependency is not ✅:
   - If the phase says a **stub** is allowed, build against the stub described there and keep going.
   - Otherwise check whether a **later phase of your own** has no unmet dependencies. If so, tell your human you are skipping ahead and do that one.
   - If nothing is unblocked, stop and print exactly:

     ```
     ⏸ WAITING
     My completed parts: <list your ✅ checkpoints>
     Blocked on: <Checkpoint ID> "<name>" owned by <Owner>
     Resume me after <Owner> marks <Checkpoint ID> ✅ in docs/STATUS.md and pushes.
     ```

When you finish a checkpoint:
1. Make sure its **acceptance criteria** in your team doc all pass (run them, do not assume).
2. Set your row in `docs/STATUS.md` to `✅` with the short commit hash and date, then commit and push.
3. Print exactly:

   ```
   ✅ CHECKPOINT <ID> "<name>" DONE (commit <hash>)
   Unblocks: <list the people and checkpoints that depend on it, from docs/02-PLAN-AND-SYNC.md>
   Next for me: <next phase>
   ```

## 6. Engineering rules
- TypeScript everywhere, `strict: true`, ESM, Node 22, pnpm workspaces.
- Validate every external input with the Zod schemas from `@mcpify/contracts`.
- Tests with Vitest. Every package has at least one test for its main behaviour.
- Keep functions small; no dead code; no `any` unless it carries a comment saying why.
- Read a library's current docs before using an API you are not sure about (MCP SDK, WebMCP, MCP-B, ElevenLabs, AWS SDK). Do not guess signatures.

## 7. Calling Claude (LLM)
- Always go through `@mcpify/llm` (owned by Subhash). Never construct an Anthropic client anywhere else.
- Model: **Claude Haiku 5.5**: `claude-haiku-5-5` on the Claude API, `anthropic.claude-haiku-5-5` on Amazon Bedrock (Mantle client).
- For JSON results use structured outputs (`client.messages.parse` with `zodOutputFormat`). Do not use assistant prefill (it returns a 400 on current models) and do not force `tool_choice`.
- Never send passwords, OTPs or real personal data to the LLM. Redact field values marked `sensitive` before any LLM call.

## 8. Safety rules for the product (non-negotiable)
- Steps with risk `auth` (login, OTP, CAPTCHA, payment) are **always** done or approved by the human. Never automate CAPTCHA solving. Never auto-repair `auth` or `commit` steps.
- Real third-party or government websites are touched **only** in dry-run mode (no request that sends data), at human pace, a few runs at most. Benchmarks run only on our own demo portals.
- Never store passwords or OTPs anywhere (logs, database, traces, receipts).
