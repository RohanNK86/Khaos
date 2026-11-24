# @mcpify/portals: demo portals

`pnpm portal` (from the repo root) starts **Portal 1, State Scholarship Portal (DEMO)** on http://localhost:5101.

| Page | What |
|---|---|
| `/` | home |
| `/apply/1` → `/apply/2` → `/apply/3` → `/apply/done` | 3-step application; Application ID `SSP-2026-000123` |
| `/status` | status lookup (Application ID + date of birth) |
| `/phone` | simulated phone: shows the SMS/OTP sent to each mobile number (auto-refreshes) |
| `/__lab` | Layout Lab UI (judges can toggle mutations live) |
| `/__lab/state`, `/__lab/mutations`, `/__lab/reset`, `/__lab/otp?session=`, `/__lab/captcha?session=` | test hooks, header `x-lab-token: $LAB_TOKEN` (default `changeme`) |

Owner mode (`OWNER_MODE=1` or `?owner=1`) adds `data-mcpify="<param>"` to every control and the `mcpify.js` script tag.

Field ids are ASP.NET style: `ctl00_ContentPlaceHolder1_txtApplicantName`, names `ctl00$ContentPlaceHolder1$txtApplicantName`.
Page 1 uses table-cell labels (no `<label for>`), page 2 uses `<label for>`, page 3 is mixed. Test data must be fictional.
