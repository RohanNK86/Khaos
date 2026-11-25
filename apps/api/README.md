# @mcpify/api

Fastify 5 + Drizzle (Postgres) API at `http://localhost:4000` (env `API_PORT`). Implements every endpoint of
`docs/01-CONTRACTS.md` §11, runs tools server-side (Playwright), issues signed receipts, and proxies agent steps to Claude.

## Run
```bash
docker compose up -d                 # Postgres 16 on :5432
pnpm --filter @mcpify/api dev        # migrates on startup; seeds fixtures/ when the tools table is empty
pnpm --filter @mcpify/api seed       # idempotent: upsert fixtures/sites.json + fixtures/tools/*.json (keeps ids and stored statuses)
pnpm demo                            # from the repo root: API + portals + MCP server
```
Env (`.env` at the repo root, optional): `DATABASE_URL`, `API_PORT`, `HEADLESS=1` (no visible Chromium),
`BLOB_DIR` (default `.data/blobs`), `KEY_DIR` (default `.data/keys`), `LLM_PROVIDER` + credentials for `/agent/step`, `API_LOG=1`.

Schema changes: edit `src/db/schema.ts`, then `pnpm --filter @mcpify/api db:generate` and commit `drizzle/`.
`db:migrate` applies migrations with drizzle-kit (the server also applies them on startup).

## Layout
- `src/db/` schema, connection + migrations; `src/store.ts` all queries.
- `src/routes/` one file per area; `src/tools-service.ts` create/approve/disable/patch (+ audit).
- `src/runs/run-manager.ts` live runs: one browser context per run, each pause returns to the HTTP caller, the redacted run
  is persisted after every step, idle runs are cancelled after 10 min, receipts are issued for succeeded runs that executed a commit step.
  OTPs and `sensitive` inputs are masked everywhere they could appear (stored run, responses).
- `src/runs/repair-hook.ts`: `onStepFailed(run, tool, evidence)` is called for every failed run. Plug repair in with
  `setRepairHandler(async (run, tool, evidence) => ({ ...run, status: "repair_pending" }))` (default: keep it `failed`).

Approving a tool disables any other approved tool with the same site + name (the new one replaces it).

## curl examples
```bash
API=http://localhost:4000
curl $API/health
curl $API/sites
curl "$API/sites/manifest?origin=http://localhost:5101"
curl -X POST $API/sites -H 'content-type: application/json' \
  -d '{"origin":"http://localhost:5102","slug":"fees","name":"University Fee Portal (DEMO)","mode":"owner"}'

# tools
curl "$API/tools?status=approved"
curl $API/tools/5c1a0b6e-0000-4000-8000-000000000002
curl $API/tools/5c1a0b6e-0000-4000-8000-000000000002/versions/1
curl -X POST $API/tools -H 'content-type: application/json' -d @recordings/apply_scholarship.draft.json   # → draft v1
curl -X POST $API/tools/<id>/approve
curl -X POST $API/tools/<id>/disable
curl -X POST $API/tools/<id>/patch -H 'content-type: application/json' -d '{"stepId":"enter_email","step":{...},"reason":"label changed"}'

# runs (each call returns at the next pause or end)
curl -X POST $API/runs -H 'content-type: application/json' -d '{"toolId":"5c1a0b6e-0000-4000-8000-000000000002","inputs":{"application_id":"SSP-2026-000001","date_of_birth":"2005-04-12"},"mode":"owner","dryRun":false}'
curl -X POST $API/runs -H 'content-type: application/json' -d '{"toolId":"5c1a0b6e-0000-4000-8000-000000000001","inputs":{"course":"MBBS"}}'   # → 400 "Please fix the inputs: ..."
curl -X POST $API/runs/<runId>/continue -H 'content-type: application/json' -d '{"approve":true}'
curl -X POST $API/runs/<runId>/continue -H 'content-type: application/json' -d '{"value":"123456"}'
curl -X POST $API/runs/<runId>/cancel
curl $API/runs/<runId>
curl "$API/runs?toolId=5c1a0b6e-0000-4000-8000-000000000001&limit=10"
curl $API/runs/<runId>/blocked                      # extra: requests blocked by the dry-run network guard
curl -X POST $API/runs/report -H 'content-type: application/json' -d @run.json   # client-side runs → {id}

# receipts
curl -X POST $API/receipts/issue -H 'content-type: application/json' -d '{"runId":"<runId>"}'
curl $API/receipts/<receiptId>
curl $API/receipts/<receiptId> | curl -X POST $API/receipts/verify -H 'content-type: application/json' -d @-   # → {"valid":true}

# repairs (POST applies the auto-apply rule: read/fill + sandbox passed + confidence ≥ 0.8 → auto_applied, version+1)
curl -X POST $API/repairs -H 'content-type: application/json' -d @proposal.json
curl "$API/repairs?status=pending"
curl -X POST $API/repairs/<id>/approve
curl -X POST $API/repairs/<id>/reject

# audit, blobs, static, agent proxy
curl "$API/audit?siteId=site-scholarship&limit=20"
curl -X POST $API/blobs -H 'content-type: text/html' --data-binary '<html>snapshot</html>'   # → {"blobId":"<sha256>"}
curl $API/blobs/<blobId>
curl $API/static/mcpify.js                          # 404 until packages/agent-ready builds dist/mcpify.js
curl -X POST $API/agent/step -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"tools":[]}'   # 503 without LLM credentials; 30/min per IP; max_tokens ≤ 4000
```
Errors are always `{ "error": string, "details"?: unknown }` with a proper status code.

## Tests
`pnpm --filter @mcpify/api test` needs the docker Postgres. Each test file drops and recreates its own database
(`mcpify_test_api_*`) and drops it at the end. The full run flow through a real browser is tested in `apps/mcp-server/tests/e2e.test.ts`.
