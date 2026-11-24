# Sinchana: demo portals, Layout Lab, dashboard, voice client

**Start Claude Code in the repo root and say:**
> I am Sinchana. Read CLAUDE.md, then docs/00-ARCHITECTURE.md, docs/01-CONTRACTS.md, docs/02-PLAN-AND-SYNC.md, docs/STATUS.md and docs/team/sinchana.md. Execute my plan phase by phase, following the waiting protocol. Before each phase, tell me what you're about to do.

You own: `apps/portals`, `apps/dashboard`, `apps/voice`.
Your portals are the **test bed for the whole team**. Portal 1 (C2) unblocks Rohan, Chaitanya and Subhash, so make it your first priority.

---

## Phase N1: Portal 1, State Scholarship Portal (DEMO) → **C2** (Day 1–2)
**Depends on:** C0. (While waiting for C0, read the docs and sketch the pages.)

Build `apps/portals` as **one Express app per portal** (shared code in `apps/portals/src/shared/`), server-rendered HTML with no frontend framework. It should **look like a real legacy government portal**: tables for layout, ASP.NET-style ids (`ctl00_ContentPlaceHolder1_txtApplicantName`), a header banner, small fonts, a session cookie, and full page reloads (form POST) between pages.

Every page shows a visible banner: **"DEMO PORTAL: not a real government website. Built for MCPify testing."** Use fictional names only. Do not copy any real department's name, logo or emblem.

Pages (port 5101):
1. `/`: home with a "New Scholarship Application" link and a "Check Application Status" link.
2. `/apply/1`: **Personal details**: Applicant name, Date of birth (date input), Gender (select), Mobile number, Email. Button **Next** (POST → `/apply/2`).
3. `/apply/2`: **Academic and income details**: Course (select: B.Sc, B.Com, B.A, B.E, Diploma), Year of study (select 1–4), Institution name, **Annual family income** (number), Category (select: General, OBC, SC, ST), checkbox "I declare the above information is true". Button **Next**.
4. `/apply/3`: **Documents and verification**: upload Income certificate (PDF/JPG, max 1 MB), then a **Send OTP** button (POST, generates a 6-digit OTP for this session, valid 5 minutes), OTP input, and a simple text CAPTCHA ("Type the characters: X7K9P"). Button **Submit Application**.
5. `/apply/done`: shows **Application ID** in the format `SSP-2026-000123` (sequential), plus a summary table.
6. `/status`: enter Application ID + Date of birth → shows status "Under verification".
7. `/phone`: the "phone" page showing the latest OTP for the current session (simulates an SMS). Also log the OTP to the console.

Server-side validation with legacy-style red error text next to fields (`<span class="error">`): required fields, mobile = 10 digits, income numeric, OTP correct, CAPTCHA correct, file type and size.

Test hooks (01-CONTRACTS §14): `/__lab/state`, `/__lab/mutations`, `/__lab/reset`, `/__lab/otp`, all protected by the `x-lab-token` header = `LAB_TOKEN`.
Owner mode: when `OWNER_MODE=1` or `?owner=1`, add `data-mcpify="<field_name>"` to every interactive element, and add `<script src="${API_URL}/static/mcpify.js" data-site="scholarship" defer></script>` to every page (the file comes later from Chaitanya; a 404 is fine until then).

Also add a Playwright smoke test in `apps/portals/tests/` that completes the whole application (reading the OTP from `/__lab/otp`) and asserts the Application ID appears.

**Claude Code prompt:**
> Do Phase N1 in docs/team/sinchana.md. Build Portal 1 as a legacy-looking, server-rendered Express app on port 5101 with every page, validation rule, test hook and owner-mode attribute described. Add the Playwright smoke test. Run it until it passes, then mark C2 ✅ in docs/STATUS.md and push.

**Acceptance:** `pnpm --filter @mcpify/portals dev` serves Portal 1; the smoke test passes; `/__lab/*` works with the token and returns 401 without it.
→ Mark **C2** ✅ (unblocks Rohan C3, Chaitanya C4 and Subhash C7).

## Phase N2: Layout Lab mutations M1–M10 → **C11** (Day 3–4)
**Depends on:** C2.

Mutations are toggled through `POST /__lab/mutations` and change the HTML **at render time** (keep one template, with conditionals). They must be combinable. Also build a small `/__lab` HTML page with checkboxes, so a **judge can click them live**.

| ID | Change | Expected MCPify outcome |
|---|---|---|
| M1 | Label "Annual family income" → "Family Income (per annum)" | auto-repair (heuristic: id or name still match) |
| M2 | Income input id and name renamed (`txtIncome` → `txtFamIncome`) | auto-repair (label still matches) |
| M3 | Submit button moved above the OTP section | auto-repair not allowed (commit) → **pending**, owner approves |
| M4 | Fields on page 2 reordered | engine still passes (locators don't depend on order) |
| M5 | Page 2 wrapped in an extra `<div>`/`<table>`, so CSS paths change | auto-repair (css/xpath break, label/id fine) |
| M6 | Page 2 split into two pages (2a academic, 2b income) | **needs_rerecord** (structural) |
| M7 | "Next" button text → "Continue" | commit step → **pending** for owner approval |
| M8 | New **required** field "Aadhaar last 4 digits" on page 1 | **stop safely**, needs_rerecord (new required input) |
| M9 | Course options relabelled ("B.Sc" → "Bachelor of Science") | auto-repair via LLM mapping (fill step) |
| M10 | All CSS classes renamed / random suffixes | engine still passes or auto-repair |

Write this table into `apps/portals/MUTATIONS.md`. Rohan's repair tests and Subhash's benchmark use it.

**Acceptance:** each mutation visibly changes the page; the smoke test passes with **no** mutations; `/__lab` UI toggles work.
→ Mark **C11** ✅ (unblocks Rohan's repair work).

## Phase N3: Dashboard → **C8** (Day 4–6)
**Depends on:** C5 (API). **Stub allowed:** until C5 is ✅, build the UI against `apps/dashboard/src/mock/` JSON that follows the contract types exactly.

`apps/dashboard`: Next.js (App Router) + Tailwind, port 3000. Visual style matches our deck: cream background `#F8F2E4`, ink `#1A1A1A`, orange `#FD9B36`, bold black-bordered cards with a hard offset shadow, Archivo Black headings, Space Grotesk body.

Pages:
1. **Sites**: list sites; per site, the number of approved and draft tools; the **script tag snippet** with a copy button: `<script src="https://<api>/static/mcpify.js" data-site="<slug>" defer></script>`.
2. **Tools**: table (name, version, status, steps, last updated). A tool page shows each step contract as a card (intent, action, locators, pre/post, a risk badge coloured read=grey, fill=blue, commit=orange, auth=red) plus the raw JSON. Buttons: **Approve**, **Disable**. Show version history.
3. **Record**: instructions and the exact recorder command for the selected site (Rohan's CLI: `pnpm --filter @mcpify/recorder record --site <slug> --task <name>`), plus a list of recent recordings with a "compiled → draft" link.
4. **Runs**: live list (poll every 2 s), with status, mode, dry-run flag and duration. The run page shows the step-by-step trace as a vertical timeline (passed / failed / awaiting / blocked by dry-run) and the used locator per step.
5. **Repairs**: pending proposals with an **old step vs new step** diff, the evidence (failed checks, a link to the DOM snapshot blob), sandbox result and confidence. Buttons **Approve** / **Reject**. Show auto-applied ones too.
6. **Receipts**: receipt view (summary, outputs, trace hash, key id) and a **Verify** button (`POST /receipts/verify`) showing ✅ or ❌.
7. **Audit log**: filterable by site.

**Acceptance:** with the API running and seeded, every page works against real data; you can approve a draft tool and approve a repair from the UI.
→ Mark **C8** ✅.

## Phase N4: Voice client with ElevenLabs → **C13** (Day 6–7)
**Depends on:** C7 (MCP server) and C18 (public HTTPS URL). **Before C18 is ✅:** set up the agent and test against a `cloudflared` tunnel to Subhash's local MCP server, or prepare everything and wait.

1. In the ElevenLabs dashboard, create an **Agent** ("MCPify Sahayak"). System prompt: helps students complete government and university tasks; speaks the user's language (Kannada, Hindi, English); **always reads back the confirmation preview and asks "Shall I submit?"** before calling `mcpify_continue` with `approve: true`; asks the user for the OTP when a run needs `user_input`; never invents values; at the end reads out the outputs and the receipt id.
2. Add our server as a **custom MCP server** (streamable HTTP, `PUBLIC_MCP_URL`). Use **tool approval**: auto-run read-only tools, require approval for everything else. **Read the current ElevenLabs Agents MCP docs** for exact steps.
3. Check ElevenLabs data-retention settings and note in `apps/voice/README.md` how voice data is handled. (MCP is not available in their Zero Retention Mode.)
4. `apps/voice`: a small page on port 3100 embedding the ElevenLabs agent widget, styled in our theme, with the portal visible next to it in an iframe so the demo shows the form filling.
5. Test in **Kannada and Hindi** with 10–20 real sentences from teammates. If Kannada recognition is weak, note it and try Sarvam as speech-to-text for the input (record the comparison in the README).

**Acceptance:** spoken request → tool runs → confirmation read back → OTP spoken → submitted → Application ID and receipt read out. Record a backup screen video of this working.
→ Mark **C13** ✅.

## Phase N5: Portals 2 and 3 + their tools → **C15** (Day 7–8)
**Depends on:** C6 (Rohan's compiler) for recording the tools. Build the portals before C6.

- **Portal 2: University Fee Portal (DEMO)**, port 5102, slug `fees`: login (student ID + password, demo credentials in the README; login is `auth`), dues page, "Pay semester fee" (simulated payment page with a fake card form, `auth`, irreversible), receipt number. Use it to show that **payment is never automated without the human**.
- **Portal 3: Student Bus Pass Portal (DEMO)**, port 5103, slug `buspass`: renew pass, a multi-step form with photo upload, route select, date range, OTP, pass number output.
- Same banner, test hooks, owner mode and smoke tests as Portal 1.
- With Rohan's recorder, record `pay_semester_fee` (run in dry-run for the demo), `check_dues` (read-only) and `renew_bus_pass`. Compile them, review them in your dashboard, approve.

**Acceptance:** both portals' smoke tests pass; 3 more approved tools are visible in the dashboard and callable via MCP.
→ Mark **C15** ✅.

## Phase N6: User tests + demo polish (Day 9–10)
- Run the voice flow with **5–10 real people** (classmates or family). Record per person: time to finish, number of corrections, and a one-line quote. Save to `bench/results/user-tests.md` (no personal data: first names or initials only, with consent).
- Polish the dashboard for the demo (empty states, loading states, big fonts for screen recording).
