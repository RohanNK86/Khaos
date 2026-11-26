# @mcpify/bench

## Benchmarks (C16)
```bash
docker compose up -d            # Postgres
pnpm --filter @mcpify/bench bench --n 20      # ~90 s on an M3; writes results/summary.{md,json}
```
Everything runs in-process on random ports: the 3 demo portals, the API (scratch database `mcpify_bench`), the MCP server, and a real MCP client.
Each flow: tool call → the bench answers every pause like a person would (approve; OTP from the portal's phone; CAPTCHA; demo password/test card) → terminal status. Success is checked against the portal's own state (exactly one new record for live runs, none for dry runs).
Options: `--flows apply,status,dues,pay_dry,renew`, `--no-repair`.

**Read the numbers honestly**
- Wall time includes the bench's instant answers to pauses; a real person adds their own time.
- "model calls" is 0 because the engine never calls a model during runs (no LLM is configured either).
- Layout table: each mutation starts from a fresh golden v1 in **dry run**. M3 (Submit moved) only affects the final Submit, which a dry run never reaches, so "passed unchanged" there says nothing about M3. For M1+M2, ~8 s of the time is the failed step waiting out its 8 s timeout before repair starts.
- Only our demo portals are benchmarked. Never real sites.

## Baseline (computer-use agent): not built yet
Needs an LLM key and your OK on cost. Plan: the same 5 tasks given to Claude with the computer-use tool driving a Playwright browser (screenshots + clicks), N=1 first to read token usage and estimate cost, then N=20. Before writing it, check the current computer-use tool version and beta header for the chosen model in the Claude docs. Report: wall time, model calls, tokens, success, human interventions.

## Real-site dry runs
See the header of `src/real-site.ts` and `real-site/README.md`.
