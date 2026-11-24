# 02 · Plan, checkpoints and sync

10-day buildathon. Four people work **in parallel**; the only hard sync points are the checkpoints below. Status lives in `docs/STATUS.md`.

## 1. Checkpoints
| ID | Name | Owner | Target | Depends on | Unblocks |
|---|---|---|---|---|---|
| **C0** | Repo scaffold pushed (workspace, tooling, empty packages) | Subhash | Day 1, hour 2 | none | everyone |
| **C1** | `@mcpify/contracts` implemented per 01-CONTRACTS | Subhash | Day 1 | C0 | all real imports (stubs allowed until then) |
| **C2** | Portal 1 (Scholarship) v1 running + `/__lab` hooks | Sinchana | Day 2 | C0 | Rohan C3, Chaitanya C4, Subhash C7 |
| **C3** | Recorder: Recording JSON for Portal 1 | Rohan | Day 3 | C1, C2 | Rohan C6 |
| **C4** | Engine + PlaywrightDriver pass golden tool on Portal 1 | Chaitanya | Day 3 | C1, C2 | Subhash C7, Rohan C6/C12, Chaitanya C9 |
| **C5** | API: sites, tools, recordings, blobs, audit, runs (stored) | Subhash | Day 3 | C1 | Sinchana C8, Chaitanya C10, Rohan C6/C12 |
| **C5b** | `@mcpify/llm` + `@mcpify/storage` usable | Subhash | Day 2 | C1 | Rohan C6, Subhash C14 |
| **C6** | Compiler: Recording → Tool, saved as draft | Rohan | Day 5 | C3, C4, C5, C5b | demo flow, Sinchana C15 |
| **C7** | MCP server runs approved tools with pauses (end-to-end with Claude/MCP Inspector) | Subhash | Day 5 | C4, C5 | Sinchana C13, Subhash C16 |
| **C8** | Dashboard: tools, approve, runs, audit, repairs, script tag | Sinchana | Day 6 | C5 | demo |
| **C9** | DomDriver + extension user mode + dry-run guard | Chaitanya | Day 6 | C4, C5 | C17 |
| **C10** | `mcpify.js` script tag registers WebMCP tools (owner mode in page) | Chaitanya | Day 7 | C5, C9 | demo |
| **C11** | Layout Lab mutations M1–M10 on Portal 1 | Sinchana | Day 4 | C2 | Rohan C12 |
| **C12** | Verified selective repair end-to-end | Rohan | Day 7 | C4, C5, C11 | demo |
| **C13** | Voice: ElevenLabs agent completes Portal 1 via public MCP | Sinchana | Day 7 | C7, C18 | demo |
| **C14** | Signed receipts (local Ed25519 + KMS option) + verify | Subhash | Day 6 | C5b, C7 | Sinchana C8 (receipt view) |
| **C15** | Portals 2 and 3 + their tools recorded and approved | Sinchana | Day 8 | C6 | C16 |
| **C16** | Benchmarks: MCPify vs computer-use baseline, 20+ runs/flow | Subhash | Day 8 | C7, C15 | pitch numbers |
| **C17** | Real government sites (2–3): dry-run demo via extension | Chaitanya | Day 8 | C9 | demo |
| **C18** | Public deployment (HTTPS MCP + API + portals + dashboard) | Subhash | Day 6 | C7 | C13 |
| **C19** | Integration freeze: full demo script passes twice in a row | All | Day 9 | everything | Day 10 rehearsal |

## 2. Dependency graph
```
C0 ─► C1 ─┬─► C5 ─┬─► C8 (Sinchana dashboard)
          │       ├─► C10 (mcpify.js)
          │       └─► C12 (repair)
          ├─► C5b ─► C6 (compiler), C14 (receipts)
          │
C0 ─► C2 (portal 1) ─┬─► C3 (recorder) ─► C6
                     ├─► C4 (engine) ─┬─► C7 (MCP server) ─► C18 (deploy) ─► C13 (voice)
                     │                ├─► C9 (extension) ─► C17 (real sites)
                     │                └─► C12
                     └─► C11 (mutations) ─► C12
C6 ─► C15 (portals 2,3) ─► C16 (benchmarks)
```

## 3. Who does what, day by day (parallel lanes)
| Day | Subhash | Sinchana | Rohan | Chaitanya |
|---|---|---|---|---|
| 1 | **C0** scaffold → **C1** contracts | Portal 1 build (starts after C0) | Recorder spike: capture script, fingerprinting | Engine core design + condition/locator logic with stubs |
| 2 | **C5b** llm + storage, API skeleton + DB schema | **C2** Portal 1 done + `/__lab` | Recorder CLI against Portal 1 | Golden tool fixture by hand; PlaywrightDriver |
| 3 | **C5** API endpoints | Layout Lab mutations | **C3** recorder done; compiler rules pass | **C4** engine passes golden tool |
| 4 | MCP server + RunManager | **C11** mutations; dashboard skeleton | Compiler LLM pass (Haiku 5.5) | DomDriver; extension skeleton |
| 5 | **C7** MCP end-to-end | Dashboard: tools, approve, runs | **C6** compiler saves drafts; repair heuristics | Extension side panel, run UI |
| 6 | **C14** receipts, **C18** deploy | **C8** dashboard done; ElevenLabs agent setup | Repair LLM + sandbox | **C9** extension + dry-run guard |
| 7 | Agent proxy, hardening | **C13** voice; Portal 2 | **C12** repair end-to-end | **C10** mcpify.js WebMCP |
| 8 | **C16** benchmarks | **C15** Portals 2–3 + tools | Help record P2/P3; repair tests M1–M10 | **C17** real sites dry-run |
| 9 | **C19** integration with all | Demo rehearsal, user tests (5–10 people) | Bug fixes | Bug fixes |
| 10 | Pitch numbers, backup video | Polish dashboard and voice | Polish | Polish |

## 4. Rules for parallel work
- **Stubs instead of waiting.** Every phase that could block says whether a stub is allowed. Typical stubs: a copy of the contract types; a fake API using an in-memory map; the hand-written golden tool `fixtures/tools/scholarship.apply_scholarship.v1.json` (Chaitanya, Day 2) in place of compiler output.
- **Ask, don't edit.** Need something from another person's package? Append to `docs/requests/<owner>.md`:
  `- [YYYY-MM-DD] (<you>) <what you need> — why — blocking? yes/no`
- **Daily sync (10 minutes, evening):** each person reads `docs/STATUS.md`, `docs/requests/*.md`, and states tomorrow's checkpoint.
- **Integration owner:** Subhash merges the full flow on Day 9 (C19) and calls everyone in to fix their part.

## 5. Waiting protocol (copied from CLAUDE.md §5)
Before each phase: pull, read STATUS.md. Unmet dependency → use the allowed stub, or skip to an unblocked later phase, or print the `⏸ WAITING` block and stop. After a checkpoint: verify acceptance criteria, mark ✅ in STATUS.md with the commit hash, push, print the `✅ CHECKPOINT` block.

## 6. Definition of done (C19 demo script)
1. Dashboard: Portal 1 shows "0 tools". Record `apply_scholarship` with the recorder → compiled draft appears → owner approves → copy script tag.
2. Claude (or MCP Inspector) calls `scholarship__apply_scholarship` → confirmation pause → OTP pause (OTP from `/phone`) → submit → receipt verifies ✅.
3. Voice: the same flow through ElevenLabs in Kannada or Hindi.
4. Judge enables mutation M1 → the run fails a postcondition → auto-repair (v2) → rerun passes. Mutation M8 → stops safely → shows in dashboard as `needs_rerecord`.
5. Extension on a real government site: dry-run fills the form, network guard blocks all sends, log shows blocked commit steps.
6. Benchmark slide numbers come from `bench/results/*.json`.
