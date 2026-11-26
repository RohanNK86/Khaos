# MCPify demo guide (full product)

## Once per laptop
```bash
git pull && corepack enable && pnpm install
pnpm --filter @mcpify/portals exec playwright install chromium
docker compose up -d                  # Postgres (Docker Desktop must be running)
```
`.env` (git-ignored) needs `ANTHROPIC_API_KEY` + `LLM_PROVIDER=anthropic` for the AI parts, `ELEVENLABS_API_KEY` for voice.

## Start everything
```bash
pnpm demo:all        # API :4000, portals :5101-5103, MCP :4100, voice page :3100, dashboard :3000
```
Open tabs: **:4100** live run view · **:3000** dashboard · **:5101/phone** (the "phone") · **:5101/__lab** (Layout Lab).
Open **Claude Code in the repo root**, approve the `mcpify` MCP server once, check `/mcp` shows it connected.
Runs open a visible Chromium window that highlights every action (set `HEADLESS=1` to hide it).

## The demo (about 6 minutes)
1. **The legacy site (20 s)**: Portal 1, three pages, OTP, CAPTCHA, no API.
2. **Record once → tool (60 s)**:
   `pnpm --filter @mcpify/recorder record --site scholarship --task look_up_status --url http://localhost:5101/status` → look up an application → type `done`.
   `pnpm --filter @mcpify/compiler compile --recording <file printed>` (one Claude Haiku 5.5 call names everything) →
   `pnpm --filter @mcpify/mcp-server approve <draft printed>`. Show it in the dashboard → Tools (step cards, risk badges).
3. **The agent uses it (90 s)**, in Claude Code:
   > Use the mcpify tools to apply for the state scholarship for me. Name Asha Demo, born 12 April 2005, female, mobile 9876543210, email asha.demo@example.com, B.Sc 2nd year at Demo Government College, family income 1.8 lakh a year, OBC. I confirm the declaration is true.

   Confirm → OTP from `/phone` → CAPTCHA from the browser window → confirm → Application ID. Then: *"Verify the receipt"* and *"Check the status of that application"*.
4. **The site changes and MCPify heals (60 s)**: Layout Lab → tick **M1 + M2** (income label and id renamed). Ask for a **dry run** of the same application. The live view shows the income step fail, repair, and the same run carry on; the dashboard shows tool **v2** and the auto-applied repair (old step vs new step). Then tick **M8** (new required field) → MCPify **stops safely** and asks for a re-record. Reset the lab afterwards.
5. **Payments stay human (30 s)**: *"Pay my semester fee, student ID DEMO2026001"* → it asks you for password and card details itself (never stored), confirmation before Pay. Use dry run if short on time.
6. **One script tag (30 s)**: open `http://localhost:5101/?owner=1` → DevTools console `MCPify.tools` → tools registered with WebMCP. Dashboard → Sites shows the script tag.
7. **User mode on any site (30 s)**: Chrome → `chrome://extensions` → Developer mode → Load unpacked `apps/extension/dist`. On a non-demo site the side panel forces dry run and blocks every send.
8. **Voice (optional)**: `pnpm voice:up` in another terminal, then talk on `http://localhost:3100`. Needs the one-time ElevenLabs MCP terms (see apps/voice/README.md). Keep it short on the free plan.
9. **Numbers (20 s)**: `bench/results/summary.md`: 100/100 runs, 0 model calls per run, layout-change table. Say only what it measured.

## If something breaks
| Problem | Fix |
|---|---|
| Claude Code doesn't see tools | `/mcp` → reconnect; check `curl localhost:4100/health` |
| "API not reachable" | `docker compose up -d`, restart `pnpm demo:all` |
| A portal looks changed | Layout Lab → Reset |
| Live run fails on stage | Play the backup video (record one after rehearsal) |
