# @mcpify/portals: demo portals

`pnpm portal` (from the repo root, same as `pnpm --filter @mcpify/portals dev`) starts **all three** demo portals.
Ports come from `PORTAL_SCHOLARSHIP_PORT`, `PORTAL_FEES_PORT`, `PORTAL_BUSPASS_PORT` (defaults below).
The package exports `createScholarshipPortal()`, `createFeesPortal()` and `createBusPassPortal()` (each returns an Express app).

| Portal | Port | Slug | Factory |
|---|---|---|---|
| State Scholarship Portal (DEMO) | 5101 | `scholarship` | `createScholarshipPortal()` |
| University Fee Portal (DEMO) | 5102 | `fees` | `createFeesPortal()` |
| Student Bus Pass Portal (DEMO) | 5103 | `buspass` | `createBusPassPortal()` |

Everything is fictional; every page shows the red DEMO banner. Test data must be fictional.

## Common to all portals
- `/phone`: simulated phone that shows the SMS/OTP sent to each mobile number (auto-refreshes).
- `/__lab`: Layout Lab UI. Test hooks (header `x-lab-token: $LAB_TOKEN`, default `changeme`):
  `GET /__lab/state`, `POST /__lab/mutations`, `POST /__lab/reset`, `GET /__lab/otp?session=<id|latest>`, `GET /__lab/captcha?session=` (Portal 1 only).
- Owner mode (`OWNER_MODE=1` or `?owner=1`) adds `data-mcpify="<param>"` to every control and the `mcpify.js` script tag with the portal's slug.
- Session cookie `ASP.NET_SessionId` (use it as `session=` for the OTP hook).

## Portal 1: State Scholarship Portal (DEMO), 5101
| Page | What |
|---|---|
| `/` | home |
| `/apply/1` → `/apply/2` → `/apply/3` → `/apply/done` | 3-step application; Application ID `SSP-2026-000123` |
| `/apply/2b` | only with mutation M6 (page 2 split into 2a/2b) |
| `/status` | status lookup (Application ID + date of birth) |

Field ids are ASP.NET style: `ctl00_ContentPlaceHolder1_txtApplicantName`, names `ctl00$ContentPlaceHolder1$txtApplicantName`.
Page 1 uses table-cell labels (no `<label for>`), page 2 uses `<label for>`, page 3 is mixed. Mutations M1–M10: see `MUTATIONS.md`.

## Portal 2: University Fee Portal (DEMO), 5102
**Demo credentials:** Student ID `DEMO2026001`, password `demo@123` (also `DEMO2026002` / `demo@456`).
**Test card (the only one accepted):** `4111 1111 1111 1111`, any future expiry such as `12/30`, any 3-digit CVV such as `123`.

| Page | What |
|---|---|
| `/login` | Student ID + password (`txtStudentId`, `txtPassword`, `btnLogin`) |
| `/dues` | read-only dues table: `lblSemesterFee`, `lblAmountDue` (`Rs. 45,500.00`), `lblDueDate` (`15-12-2026`), `lblFeeStatus` (`Due`/`Paid`); button `btnPayFee` |
| `/pay` | simulated payment gateway ("This is a simulation; no money moves"): `txtCardNumber`, `txtExpiry`, `txtCvv`, `txtCardName`, `btnPay` |
| `/pay/verify` | OTP sent to the registered mobile (see `/phone`): `txtOtp`, `btnSubmitOtp` |
| `/pay/receipt` | receipt `lblReceiptNo` = `UFP-RCPT-2026-00001` (then 00002, ...) |
| `/logout` | log out |

`/__lab/state` → `{ mutations: [], applications: payments, payments }`. A payment keeps only the card's last 4 digits; passwords, card numbers and CVVs are never stored.

## Portal 3: Student Bus Pass Portal (DEMO), 5103
**Demo pass:** `BPS-2025-004217`, date of birth `2004-08-19` (Meera Demo). Also `BPS-2025-003150` / `2003-01-05`.
Sample photo: `fixtures/files/sample-student-photo.png` (fictional placeholder silhouette).

| Page | What |
|---|---|
| `/renew/1` | existing pass number + date of birth (`txtPassNo`, `txtDob`, `btnNext1`) |
| `/renew/2` | personal details shown read-only; tick `chkConfirm`, `btnNext2` |
| `/renew/3` | photo `fuPhoto` (JPG/PNG ≤ 500 KB), route `ddlRoute`, `txtFromDate` / `txtToDate` (to > from, at most 6 months), `btnNext3` |
| `/renew/4` | `btnSendOtp`, then `txtOtp`, `btnSubmit` ("Submit Renewal") |
| `/renew/done` | new pass number `lblPassNo` = `BPS-2026-000501` (then 000502, ...) |
| `/status` | pass status lookup (`txtStatusPassNo`, `btnCheck`, result `lblPassStatus`) |

`/__lab/state` → `{ mutations: [], applications: renewals, renewals }`.

## Golden tools
`node fixtures/tools/golden.gen.mjs` (Portal 1) and `node fixtures/tools/golden-portals23.gen.mjs` (Portals 2 and 3) write the hand-written tools:
`fees.check_dues.v1.json`, `fees.pay_semester_fee.v1.json`, `buspass.renew_bus_pass.v1.json`. Sites are in `fixtures/sites.json`.

## Tests
`pnpm --filter @mcpify/portals test`: Playwright smoke tests per portal, the M6 test, contract validation of the new golden tools/sites,
and engine runs of each new golden tool (`tests/golden-tools.test.ts`, which imports `packages/engine/src` by relative path because
`@mcpify/engine` dev-depends on this package).
