# Layout Lab mutations (Portal 1)

Toggle with `POST /__lab/mutations {enable:[], disable:[]}` (header `x-lab-token`), or click them at `http://localhost:5101/__lab`.

| ID | Change | Expected MCPify outcome | Implemented |
|---|---|---|---|
| M1 | Label "Annual family income" → "Family Income (per annum)" | engine passes via id fallback / auto-repair | ✅ |
| M2 | Income input id and name renamed (`txtIncome` → `txtFamIncome`) | auto-repair (label still matches) | ✅ |
| M3 | Submit button moved above the OTP section | commit step → **pending**, owner approves | ✅ |
| M4 | Fields on page 2 reordered | engine still passes | ✅ |
| M5 | Page 2 wrapped in an extra div/table, CSS paths change | auto-repair (css/xpath break, label/id fine) | ✅ |
| M6 | Page 2 split into two pages | **needs_rerecord** | ⬜ (after demo) |
| M7 | "Next" button text → "Continue" | auto-repair (Next is a `fill` step: it only saves a draft) | ✅ |
| M8 | New **required** field "Aadhaar (last 4 digits)" on page 1 | **stop safely**, needs_rerecord | ✅ |
| M9 | Course options relabelled ("B.Sc" → "Bachelor of Science") | auto-repair via option mapping | ✅ |
| M10 | All CSS classes renamed with random suffixes | engine still passes | ✅ |
