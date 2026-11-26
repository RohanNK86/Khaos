# STATUS board

Each person edits **only their own rows**. Status: ⬜ todo · 🟡 in progress · ✅ done · ⛔ blocked.
When marking ✅, fill in the short commit hash and date. Always `git pull --rebase` before editing.

| ID | Name | Owner | Status | Commit | Date | Notes |
|---|---|---|---|---|---|---|
| C0 | Repo scaffold | Subhash | ✅ | 0f88344 | 2026-11-25 | |
| C1 | Contracts package | Subhash | ✅ | dcf2cbb | 2026-11-25 | zod v4 |
| C2 | Portal 1 + /__lab | Sinchana | ✅ | 17e22ef | 2026-11-25 | built by Subhash's session; M1–M5, M7–M10 |
| C3 | Recorder | Rohan | ✅ | b3f6554 | 2026-11-26 | recorder: programmatic + CLI, snapshots, dry-run guard |
| C4 | Engine + PlaywrightDriver (golden tool passes) | Chaitanya | ✅ | 05e4f61 | 2026-11-25 | built by Subhash's session |
| C5 | API core | Subhash | ✅ | 1d14fed | 2026-11-26 | Fastify + Drizzle/Postgres, all §11 endpoints + list endpoints |
| C5b | llm + storage packages | Subhash | ✅ | f823066 | 2026-11-26 | llm (Bedrock Mantle / Claude API; mocked until keys) + storage (local Ed25519; KMS/S3 later) |
| C6 | Compiler | Rohan | ✅ | b3f6554 | 2026-11-26 | rules pass verified end to end; LLM pass mocked until keys |
| C7 | MCP server end-to-end | Subhash | ✅ | 1d14fed | 2026-11-26 | MCP server proxies to the API |
| C8 | Dashboard | Sinchana | ✅ | 475ea0f | 2026-11-26 | Next.js dashboard, checked on mock and real API |
| C9 | DomDriver + extension + dry-run guard | Chaitanya | ✅ | fd796ea | 2026-11-26 | DomDriver + MV3 extension + DNR dry-run guard |
| C10 | mcpify.js WebMCP script tag | Chaitanya | ✅ | fd796ea | 2026-11-26 | mcpify.js registers tools with WebMCP / MCP-B |
| C11 | Layout Lab M1–M10 | Sinchana | ✅ | ee02ae0 | 2026-11-26 | M1–M10 all implemented |
| C12 | Selective repair | Rohan | ✅ | 75c876b | 2026-11-26 | self-repair inside live runs; M1+M2 and M9 heal, M6/M8 stop safely |
| C13 | Voice via ElevenLabs | Sinchana | ✅ | 32d55f6 | 2026-11-27 | voice → ElevenLabs agent → tunnel → MCPify works (English); Kannada/Hindi tests pending |
| C14 | Signed receipts | Subhash | ✅ | 987b900 | 2026-11-25 | local Ed25519 (KMS after demo) |
| C15 | Portals 2 and 3 + tools | Sinchana | ✅ | ee02ae0 | 2026-11-26 | Portals 2 + 3 + 3 golden tools |
| C16 | Benchmarks | Subhash | 🟡 | 807bd36 | 2026-11-26 | MCPify measured (5 flows × 20); computer-use baseline needs a key |
| C17 | Real gov sites dry-run | Chaitanya | 🟡 | | 2026-11-27 | India Post Calculate Postage: dry run verified (4 steps, POST blocked, nothing sent); 1 site so far |
| C18 | Public deployment | Subhash | 🟡 | 27a58c7 | 2026-11-26 | deploy files ready in infra/; not deployed (on hold) |
| C19 | Integration freeze | All | ⬜ |  |  | full rehearsal with the team |
