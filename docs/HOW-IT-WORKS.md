# How MCPify works (plain language)

For anyone new to the project: teammates, mentors, a government IT team. Commands are in `docs/DEMO.md` and each package's README.

## 1. What is a "recording"? (It is not a video.)
You use the website normally in a browser that MCPify opens; the recorder writes down **what happened, as data**, not pixels:
- **Events:** "typed `Asha Demo` into the field labelled *Applicant Name*", "chose *Female* in *Gender*", "clicked *Next*". Each event stores the element's **fingerprint**: its label (including the table cell to the left, as on old government forms), id, name, nearby heading, button text, and position in the page.
- **Page snapshots:** a copy of the page's HTML after each event, so the compiler can check its work later.
- **Masking:** OTP, CAPTCHA, password, PIN, Aadhaar and CVV values are replaced by `•••` inside the page, before they leave it.
- **Noise removal:** 40 keystrokes in one box become one "typed" event; clicks on labels that only focus a box are dropped.

You never write notes yourself. Start it, do the task, type `done`:
```bash
pnpm --filter @mcpify/recorder record --site scholarship --task look_up_status --url http://localhost:5101/status
```
The recording is saved as a readable JSON file in `recordings/`. Sites must be listed in `fixtures/sites.json`. On a real site you did not build, add `--dry-run`: every sending request is blocked, so you can only record up to the first send button. Use dummy or public data only.

## 2. What does "compiling" do?
It turns the event list into a **tool**: a function signature plus a list of **Semantic Step Contracts**.

**Pass 1: rules (exact, no AI)**
1. Events become steps: typed → fill · dropdown → select · checkbox → check · file → upload · masked OTP/CAPTCHA → ask the human · click → click.
2. Each step gets a **risk level**: a "Next" button that leads to the next page of the same form = `fill` (only saves a draft); Submit / Send OTP / Pay / Confirm and the last button = `commit` (needs the user's "yes"); OTP / CAPTCHA / password = `auth` (human only).
3. Each step gets **2–5 ways to find its element**, best first (test id, id, name, label, button text, nearby text, CSS, XPath). The compiler opens the saved snapshot of that page and keeps **only the ways that find exactly one visible element, and the right one**.
4. Each step gets **checks**: before (the field is visible) and after (the field holds the value and no error appears; the page moved on after Next/Submit).
5. The **output** on the last page (e.g. `Application ID: SSP-2026-000123`) is detected and a pattern is built to read it.
6. The **function signature**: every filled field becomes a parameter named from its label (`Annual family income` → `annual_income`), with its type, dropdown options as allowed values, and `*` fields as required.

**Pass 2: AI polish (one Claude Haiku 5.5 call, optional)**
Better parameter names, a title, one plain sentence per step, and a description for agents. Values are masked/redacted before the call. The AI **cannot add steps or lower a risk level**. Without an AI key, Pass 1 alone gives a working tool.

**Then:** an optional dry-run validation on the live site, saved as a **draft**; the owner reviews it in the dashboard and approves; it is published as an MCP function. Cost: a few seconds and about 2,000 AI tokens, once per task. Every later use runs with **zero** AI calls.

**One step, before and after**
- Recorded: `typed "180000" into input labelled "Annual family income" (id …txtIncome)`
- Compiled: intent *fill the applicant's annual family income* · action fill `annual_income` · find by id → name → label (each checked unique) · before: field visible · after: field holds the value, no error · risk `fill` (auto-repair allowed)

## 3. How the website becomes functions agents can call
One tool = one complete task (apply, check status, pay fee, renew pass). When an agent asks the MCP server "what can you do?", it sees for example:
- **name:** `scholarship__apply_scholarship`
- **description:** what it does and when it pauses (confirmation, OTP)
- **inputs:** applicant name, date of birth, gender, mobile, course, income…
- **returns:** `application_id`

When the agent calls it, the engine opens the real website, performs every step exactly as compiled, checks each one, pauses for the human at sending and auth steps, and returns the result with a signed receipt. The agent never sees the page; it called a function.

## 4. Adopting MCPify on a government portal (with permission: "owner mode")
1. **Agreement and test copy:** an MoU on scope, data handling and hosting; a **staging copy** of the portal and **test accounts**, so no real citizen data is used while building.
2. **Record each task once** on staging (department staff or our team). A typical portal needs 5–20 tools.
3. **Compile → department reviews and approves** every tool and step in the dashboard. Only approved tools go live.
4. **Add one script tag** to the page template. Optional: stable `data-mcpify="field_name"` attributes on fields, which makes tools almost unbreakable.
5. **Agents use it two ways:**
   - **In the browser (WebMCP):** the script registers the tools inside the page; an assistant in the citizen's browser uses them **in the citizen's own logged-in session**.
   - **Remotely (MCP server):** the same tools at an address like `mcp.<portal-domain>`; Claude, other assistants, a voice agent or a Common Service Centre operator app connect to it.
6. **The citizen stays in control:** logs in themselves, gets the OTP on their own phone, sees a preview, says "yes"; gets a signed receipt. The department has a full audit log and can **disable any tool instantly**.

**Hosting:** our cloud, or inside the government's own infrastructure (data centre / government cloud), so data stays in India and under their control. The in-browser route keeps the citizen's session on their own device.

**When the site changes:** the web team can run MCPify's checks before publishing an update; if something still breaks, selective repair fixes small changes automatically and alerts the department for anything structural.

## 5. Without permission ("user mode")
The Chrome extension runs tools in the user's own tab. On any site that has not opted in, **dry run is forced and every sending request is blocked**: it fills and verifies, it never sends. Example: India Post "Calculate Postage" (`bench/real-site/`), where 4 steps were verified and 5 sending requests (including the page's own background requests) were blocked.

## 6. Voice
- **The voice page** (`apps/voice`, http://localhost:3100) is a small demo page, not a dashboard: the ElevenLabs talk button beside the portal and the live run view, so you can watch the form being filled while you speak.
- **How it connects:** your voice → the ElevenLabs agent "MCPify Sahayak" (runs on ElevenLabs' servers) → our MCP tools over the internet → the MCPify engine → the portal. It uses exactly the same tools as Claude, reads the preview aloud, asks "Shall I submit?" and asks for the OTP.
- **Locally:** `pnpm demo`, then `pnpm voice:up` (opens a temporary public tunnel, registers it with ElevenLabs, creates/updates the agent), then `pnpm --filter @mcpify/voice start`.
- **In the real world:** the same widget can be added to any website with two lines of HTML, or the agent can be connected to a phone number. That needs the permanent public MCP address from the AWS deployment.
- **Status:** works end to end in English; Kannada and Hindi are configured and still being tested.
