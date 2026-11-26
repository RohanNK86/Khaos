# MCPify build docs

Team **khaos**: 10-day buildathon. Four people, four Claude Code sessions, one repo, working in parallel.

## How to start (each person)
1. `git clone https://github.com/RohanNK86/Khaos.git && cd Khaos` (or `git pull` if you already have it).
2. Install Node 22, pnpm 9, Docker. Copy `.env.example` to `.env` once Subhash's scaffold (C0) is pushed.
3. Open Claude Code **in the repo root** and paste the first line from your file:

| Person | Plan | Builds |
|---|---|---|
| Subhash | [team/subhash.md](team/subhash.md) | scaffold, contracts, API, MCP server, receipts, deploy, benchmarks |
| Sinchana | [team/sinchana.md](team/sinchana.md) | 3 demo portals, Layout Lab, dashboard, ElevenLabs voice |
| Rohan | [team/rohan.md](team/rohan.md) | recorder, compiler (step contracts), selective repair |
| Chaitanya | [team/chaitanya.md](team/chaitanya.md) | verified engine, extension, mcpify.js (WebMCP), real-site dry-run |

`CLAUDE.md` in the repo root is loaded automatically by Claude Code and holds the shared rules.

## Read in this order
0. **[DEMO.md](DEMO.md): how to run and present the full product** · [HOW-IT-WORKS.md](HOW-IT-WORKS.md): plain-language explanation (recording, compiling, government adoption)
1. [00-ARCHITECTURE.md](00-ARCHITECTURE.md): what we're building and where everything lives
2. [01-CONTRACTS.md](01-CONTRACTS.md): shared types and APIs (**source of truth**)
3. [02-PLAN-AND-SYNC.md](02-PLAN-AND-SYNC.md): checkpoints, day plan, waiting protocol
4. [STATUS.md](STATUS.md): live checkpoint board
5. Your own team file

## When your Claude session stops with "⏸ WAITING"
It finished everything it can without someone else's checkpoint. Check `STATUS.md`, ping the owner, and once they've pushed, tell your session: *"Pull and continue."*

## Needing something from someone else
Never edit their folder. Append a line to `docs/requests/<owner>.md` and tell them.
