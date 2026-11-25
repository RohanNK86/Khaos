# @mcpify/voice: Sahayak voice client (C13 prep)

A small page on **http://localhost:3100** with the ElevenLabs Agents widget ("MCPify Sahayak") next to two iframes: the demo portal (`http://localhost:5101`) and the MCP server's live verified-run view (`http://localhost:4100`).

```bash
pnpm --filter @mcpify/voice dev        # watches src/, reads the root .env
pnpm --filter @mcpify/voice test
```

| Env (root `.env`) | Used for |
|---|---|
| `ELEVENLABS_AGENT_ID` | Agent id for the widget. Empty → the page shows setup steps instead. |
| `PUBLIC_MCP_URL` | HTTPS URL of `apps/mcp-server` `/mcp`, entered in ElevenLabs (not used by the page itself). |
| `PORTAL_URL` (optional) | Portal iframe, default `http://localhost:5101`. |
| `MCP_LIVE_URL` (optional) | Live run iframe, default `http://localhost:4100`. |
| `VOICE_PORT` (optional) | Default `3100`. |

`GET /config.json` returns only public values (`agentConfigured`, `agentId`, iframe URLs, `mcpUrlConfigured`). No ElevenLabs API key is ever needed by this page.

Widget embed used (from the ElevenLabs widget docs, checked 26 Nov 2026):
```html
<elevenlabs-convai agent-id="<agent-id>"></elevenlabs-convai>
<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
```

---

## ElevenLabs setup (exact steps)

Sources: elevenlabs.io/docs/agents-platform/customization/tools/mcp and …/customization/widget. Re-check them if the dashboard looks different.

### 1. Make the MCP server reachable over HTTPS
ElevenLabs connects from its cloud, so `localhost` will not work.
- Until **C18** (public URL) is ✅: `cloudflared tunnel --url http://localhost:4100` and use `https://<random>.trycloudflare.com/mcp`.
- Put the URL in `.env` as `PUBLIC_MCP_URL`.

### 2. Add the custom MCP server
1. Open **elevenlabs.io/app/agents/integrations** → **Add Custom MCP Server**. (The first time, accept the *MCP Server Terms*; this enables MCP for the workspace.)
2. **Name:** `MCPify` · **Description:** `Verified tools for DEMO government/university portals` · **Server URL:** the `PUBLIC_MCP_URL`. If the dashboard asks for a transport, pick **Streamable HTTP** (ElevenLabs supports SSE and streamable HTTP).
3. Secret token / headers: none for the demo.
4. **Add Integration**. It tests the connection and should list: `scholarship__apply_scholarship`, `scholarship__check_application_status`, `mcpify_continue`, `mcpify_get_run`, `mcpify_cancel`, `mcpify_verify_receipt` (plus any other approved tools).

### 3. Tool approval
Choose **Fine-Grained Tool Approval** on the integration:

| Tool | Setting | Why |
|---|---|---|
| `scholarship__check_application_status` | Auto-approved | read-only |
| `mcpify_get_run` | Auto-approved | read-only |
| `mcpify_verify_receipt` | Auto-approved | read-only |
| `scholarship__apply_scholarship` (and every other site tool that fills or submits) | Requires approval | starts a submission |
| `mcpify_continue` | Requires approval | sends confirmations / OTP |
| `mcpify_cancel` | Requires approval | changes a run |

MCPify also pauses on its own at every `commit` and `auth` step (`awaiting_confirmation` / `awaiting_user_input`), so the user always hears the preview and "Shall I submit?" even if a tool were auto-approved. If "Requires approval" causes double prompts in testing, it is safe to auto-approve `mcpify_continue` because the prompt forbids `approve: true` without an explicit yes; write down what you chose.

### 4. Create the agent "MCPify Sahayak"
Dashboard: **Agents → Create agent → Blank**.
- **Name:** `MCPify Sahayak`
- **Agent language:** English, with **additional languages** Hindi and Kannada (if Kannada is not in the list, see the Sarvam note below).
- **First message:** `Namaskara! Namaste! Hello! I am Sahayak. I can help you apply for a scholarship or check your application status. Which language would you like: Kannada, Hindi or English?`
- **System prompt:** paste exactly:

```text
You are MCPify Sahayak, a friendly voice assistant that helps students complete government and university tasks on DEMO portals (State Scholarship Portal, University Fee Portal, Student Bus Pass Portal). You act only through the MCPify tools you are given; you never browse or guess.

LANGUAGE
- Reply in the language the user speaks: Kannada, Hindi or English. If they switch, you switch.
- Keep sentences short and clear. Read numbers, dates and IDs slowly, digit by digit (for example "S S P, 2 0 2 6, 0 0 0 1 2 3").

COLLECTING DETAILS
- Before calling a task tool, ask for every required field in its input schema, one or two at a time. Use the field titles as labels.
- Never invent, assume or autocomplete a value. If something is unclear, ask again. Spell back names, mobile numbers and email addresses to confirm them.
- Do not ask for passwords. Ask for an OTP or CAPTCHA only when a run asks for it.

RUNNING A TOOL
- Call the site tool (for example scholarship__apply_scholarship) with the confirmed inputs. Every tool returns JSON with run_id, status, message and sometimes need, outputs and receipt_id. You may say the message to the user.
- status "awaiting_confirmation": the portal is about to SEND data. ALWAYS read back every item in need.preview (label and value), then ask exactly: "Shall I submit?" (in the user's language). Only if the user clearly says yes, call mcpify_continue with { run_id, approve: true }. If they say no or want to change something, call mcpify_continue with { run_id, approve: false } and start again with the corrected details.
- status "awaiting_user_input": say need.prompt to the user (for example the OTP sent to their mobile, or the CAPTCHA shown on the portal screen), wait for their answer, then call mcpify_continue with { run_id, value: "<what they said>" }. Never repeat an OTP back aloud and never store it.
- status "running": call mcpify_get_run with { run_id } until it pauses or finishes.
- status "succeeded": read out every output (for example the Application ID) slowly, then say the receipt id and that it is a signed receipt they can verify. If asked, call mcpify_verify_receipt with { receipt_id }.
- status "failed", "stopped" or "repair_pending": explain the message simply, say nothing was submitted unless the message says otherwise, and offer to try again later. Never retry a submission on your own.
- status "dry_run_complete": explain that this was a practice run and nothing was sent.
- If the user wants to stop, call mcpify_cancel with { run_id }.

SAFETY
- Never call mcpify_continue with approve: true without an explicit yes from the user for that exact preview.
- Never claim something was submitted unless a tool result says status "succeeded".
- These are demo portals: use the user's test details only.
```

- **Tools / MCP servers:** attach the `MCPify` integration from step 2.
- **Voice:** any multilingual voice; TTS model must be a multilingual one.
- **Advanced → Authentication:** off (the widget requires a public agent).
- **Security → Allowlist:** add `localhost:3100` (and the public demo host later).
- Copy the **agent id** into `.env` as `ELEVENLABS_AGENT_ID`, restart `pnpm --filter @mcpify/voice dev`.

**Via the API instead:** `apps/voice/agent-config.json` holds the same name, prompt, first message and language presets. Replace `REPLACE_WITH_MCP_SERVER_ID` with the id of the integration from step 2, then:
```bash
curl -X POST https://api.elevenlabs.io/v1/convai/agents/create \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "content-type: application/json" \
  --data @apps/voice/agent-config.json
```
The response contains `agent_id`. The `language_presets` shape (`{ "<code>": { "overrides": { "agent": {...} } } }`) follows the API reference summary; if the API returns 422 on it, drop `language_presets` and add the languages in the dashboard.

### 5. Data retention
- **MCP is not available in Zero Retention Mode** (or for HIPAA workspaces), so this workspace must keep ZRM off. That means ElevenLabs stores call audio and transcripts according to the agent's **Privacy** settings.
- For the demo: set the shortest retention the dashboard allows for audio and transcripts (Agent → Advanced/Privacy → retention), and use **fictional test data only**. Spoken OTPs from the demo portal are fake codes; still, the prompt tells the agent never to repeat an OTP aloud, and MCPify never stores OTPs (they are `sensitive`, masked as `•••` in traces, receipts and the audit log).
- Tool results sent back to ElevenLabs contain the redacted preview and outputs (for example the Application ID); they never contain passwords or OTPs.

---

## Kannada / Hindi test plan

Run each line with 2–3 teammates (first names or initials only). Record: recognised correctly? (Y/N), corrections needed, notes.

| # | Lang | Spoken sentence | Expected behaviour | Result |
|---|---|---|---|---|
| 1 | kn | ನನಗೆ ವಿದ್ಯಾರ್ಥಿ ವೇತನಕ್ಕೆ ಅರ್ಜಿ ಹಾಕಬೇಕು | Starts collecting fields for `apply_scholarship` in Kannada | |
| 2 | kn | ನನ್ನ ಹೆಸರು ಕಾವ್ಯ ಡೆಮೊ | Spells back the name, asks to confirm | |
| 3 | kn | ನನ್ನ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಒಂಬತ್ತು ಸೊನ್ನೆ ಸೊನ್ನೆ … ಒಂದು | Digits captured exactly (9000000001) | |
| 4 | kn | ನಮ್ಮ ಕುಟುಂಬದ ವಾರ್ಷಿಕ ಆದಾಯ ಒಂದು ಲಕ್ಷ ಎಂಬತ್ತು ಸಾವಿರ | `annual_income` = 180000 | |
| 5 | kn | ಹೌದು, ಸಲ್ಲಿಸಿ | After the read-back: `mcpify_continue` approve=true | |
| 6 | kn | ಬೇಡ, ಕೋರ್ಸ್ ಬದಲಾಯಿಸಬೇಕು | approve=false, asks for the new course | |
| 7 | kn | ಓಟಿಪಿ ನಾಲ್ಕು ಎಂಟು ಎರಡು ಒಂಬತ್ತು ಒಂದು ಮೂರು | `value` = 482913, not repeated aloud | |
| 8 | hi | मुझे स्कॉलरशिप के लिए आवेदन करना है | Starts `apply_scholarship` in Hindi | |
| 9 | hi | मेरा कोर्स बी एस सी है, दूसरा साल | course=B.Sc, year=2nd Year | |
| 10 | hi | मेरी ईमेल kavya at example dot com है | email = kavya@example.com, spelled back | |
| 11 | hi | हाँ, जमा कर दीजिए | approve=true only after the preview | |
| 12 | hi | ओटीपी है चार आठ दो नौ एक तीन | value=482913 | |
| 13 | hi | मेरे आवेदन की स्थिति बताइए, SSP 2026 000123 | `check_application_status`, reads the status | |
| 14 | hi | रुकिए, रद्द कर दीजिए | `mcpify_cancel` | |
| 15 | en→kn | (start in English, switch to Kannada mid-call) | Agent switches language | |
| 16 | en | Is my receipt genuine? | `mcpify_verify_receipt`, says valid | |

Acceptance (C13): spoken request → tool runs → preview read back → "Shall I submit?" → OTP spoken → submitted → Application ID and receipt id read out. Record a backup screen video.

## Sarvam fallback (Kannada)
If Kannada speech recognition is weak (rows 1–7 below ~80% correct, or digits garbled):
1. Note it in the table and here.
2. Try **Sarvam** speech-to-text (Saarika model, `kn-IN`) on the same recorded sentences and compare word accuracy and digit accuracy side by side in this README.
3. If Sarvam is clearly better, the fallback for the demo is: speak Kannada into a Sarvam STT step, pass the text to the agent as a text message (the widget supports text input), keep ElevenLabs for TTS. This needs a Sarvam API key and is **not built yet**.

| Engine | Kannada sentences correct | Digits correct | Notes |
|---|---|---|---|
| ElevenLabs (agent ASR) | | | |
| Sarvam Saarika | | | |
