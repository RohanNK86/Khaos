# 03 · Demo sprint (26 Nov): what is built and how to run the demo

**Until the 26th demo, this file overrides the 10-day plan.** Scope: one working end-to-end slice on Portal 1, plus a real-site dry run.
Present it as an **early prototype, day 2 of 10**. Show no speed or cost claims beyond what the live view measures on screen.

## 1. What exists
| Part | Where | Status |
|---|---|---|
| Contracts (Zod) | `packages/contracts` | ✅ C1 |
| Portal 1 + Layout Lab + `/phone` | `apps/portals` (port 5101) | ✅ C2 |
| Verified engine + Playwright driver + network guard | `packages/engine` | ✅ C4 |
| Golden tools `apply_scholarship`, `check_application_status` | `fixtures/tools` | ✅ |
| MCP server + live run view + signed receipts | `apps/mcp-server` (port 4100) | ✅ C7, C14 |
| Real-site probe + dry-run CLI | `bench/src/real-site.ts` | ✅ (site chosen on the 26th) |
| Recorder + rules-only compiler | `apps/recorder`, `packages/compiler` | Rohan (in progress) |
| Cut until after the demo | API/Postgres, dashboard, extension, mcpify.js, LLM pass, Portals 2–3, benchmarks, KMS, voice | |

## 2. Setup (once per laptop)
```bash
git pull && corepack enable && pnpm install
pnpm --filter @mcpify/portals exec playwright install chromium
pnpm test            # everything should pass
```

## 3. Start the demo
```bash
pnpm demo            # Portal 1 on :5101 + MCP server on :4100 (visible Chromium per run)
```
Open these tabs: **http://localhost:4100** (live run view), **http://localhost:5101/phone** (the "phone"), **http://localhost:5101/__lab** (Layout Lab).
Open **Claude Code in the repo root** (VS Code extension or CLI). It reads `.mcp.json` and offers the `mcpify` server; approve it once.
Check with `/mcp` that `mcpify` is connected (6 tools). Reset the portal between rehearsals: Layout Lab → "Reset portal".

## 4. Demo script (about 4 minutes)
1. **The legacy site (20 s).** Show Portal 1: 3 pages, ASP.NET ids, table labels, OTP, CAPTCHA. "No API. No MCP. Like most government portals."
2. **(If Rohan's part is ready) Record once → tool (40 s).**
   `pnpm --filter @mcpify/recorder record --site scholarship --task apply_scholarship` → do the task once → compile → `pnpm --filter @mcpify/mcp-server approve <draft.json>`.
   Show the step contracts: intent, locators, pre/post, risk. If not ready: show `fixtures/tools/scholarship.apply_scholarship.v1.json` and say "this is the compiler's target".
3. **The agent uses it (90 s).** In Claude Code:
   > Use the mcpify tools to apply for the state scholarship for me. Name Asha Demo, born 12 April 2005, female, mobile 9876543210, email asha.demo@example.com, B.Sc 2nd year at Demo Government College, family income 1.8 lakh a year, OBC category. I confirm the declaration is true.

   The browser fills the form with every action highlighted; the live view ticks through **check → execute → verify** for each step.
   - **Pause 1, confirmation:** Claude shows the preview and asks. Say "yes".
   - **Pause 2, OTP:** read it from the `/phone` tab and tell Claude.
   - **Pause 3, CAPTCHA:** read it from the browser window. "Humans do CAPTCHA, never MCPify."
   - **Pause 4, final confirmation:** "yes" → Application ID.
   - Then: *"Verify the receipt."* → signature valid. And: *"Check the status of that application."* → read-only tool, no pauses.
4. **The site changes (40 s).** Layout Lab: tick **M4, M5, M10** (reorder, wrap, rename classes). Ask Claude for a **dry run** of the same application → still passes (locators don't depend on layout).
   Tick **M8** (new required Aadhaar field) → run again → MCPify **stops safely** at the step that failed and quotes the portal's error. "It never guesses on a changed form." (Untick afterwards.)
5. **A real government site, dry run (40 s).** `pnpm --filter @mcpify/bench real-site run real-site/<name>`: fills page 1 on the real site, stops before anything is sent, and the network guard logs any blocked sending request. Or play the 30-second video.
6. **Close (10 s).** Roadmap: one script tag for owners (WebMCP), self-repair, voice in Kannada/Hindi.

## 5. Real site prep (morning of the 26th)
1. Pick **one** public page with a form that needs no login and has no CAPTCHA before page 1. Read its terms/website policy; skip it if automation is forbidden.
2. `pnpm --filter @mcpify/bench real-site probe <url> --out real-site/<name>` → press Enter once the page is loaded.
3. Edit `bench/real-site/<name>.tool.json` (keep only page-1 fields + the first button) and `<name>.inputs.json` (**dummy values**).
4. `pnpm --filter @mcpify/bench real-site run real-site/<name> --video`, max 3–4 runs, at human pace. The video lands in `bench/results/raw/videos/`.

## 6. Fallbacks
| If this breaks | Do this |
|---|---|
| Recorder/compiler not ready | Show the golden tool JSON as the compiler target |
| Claude Code can't connect | Restart `pnpm demo`, then `/mcp` → reconnect. Last resort: `npx tsx` driver script (see `apps/mcp-server/tests/e2e.test.ts`) |
| Live run fails on stage | Play the backup video |
| Real site is down / changed | Play its 30-second video |
**Never demo without the backup video.** Record it on the morning of the 26th after two clean rehearsals; freeze code about 3 hours before the slot.

## 7. Rohan's integration point
- Recorder output: a `Recording` (01-CONTRACTS §7) in `recordings/` (git-ignored).
- Compiler output: a tool draft JSON shaped like `fixtures/tools/scholarship.apply_scholarship.v1.json`.
  `id`, `version`, `status`, `createdAt`, `updatedAt`, `siteId` may be omitted: `approve` fills them.
- `pnpm --filter @mcpify/mcp-server approve <draft.json> [--site scholarship]` → it appears in MCP as `scholarship__<name>` (overrides the golden tool with the same name). Reconnect the MCP client to refresh the list.
- Risk classes on Portal 1: page **Next = `fill`** (only saves a draft), **Send OTP / Submit = `commit`**, **OTP / CAPTCHA = `auth` + `userInput`**. Upload must come **after** Send OTP (Send OTP reloads page 3).
