# @mcpify/extension: MCPify in the user's own tab (Chrome MV3)

Side panel that lists the MCPify tools for the active tab's site, renders a form from the tool's
`inputSchema`, and runs it **in the tab you are looking at** with the verified engine:
live step timeline, confirmation dialog with a preview before every send, OTP/CAPTCHA typed by you,
outputs, and a report of the final run to `POST /runs/report`.

## Build and load (unpacked)
```bash
pnpm --filter @mcpify/extension build        # → apps/extension/dist
```
1. Open `chrome://extensions`, switch on **Developer mode** (top right).
2. **Load unpacked** → choose `apps/extension/dist`.
3. Pin MCPify, open a demo portal (`pnpm portal`, http://localhost:5101/apply/1) and click the MCPify icon:
   the side panel opens. Rebuild + press the reload icon on the extension card after code changes.

Settings tab: the API base (default `http://localhost:4000`). When the API is down, the panel falls back
to the golden tools bundled from `fixtures/tools` for the demo portal origins.

## How a run works
```
side panel (engine: runTool)  ──chrome.tabs.sendMessage──►  content script (DomDriver + IN_PAGE_JS)  ──►  page
```
The engine runs in the panel; every driver call (resolve, fill, click, …) is one message to the content
script. A click that reloads the page simply makes the next call wait for the tab to finish loading and
re-inject the content script, so multi-page server-rendered forms need no resume logic here (the
in-page resume helpers in `@mcpify/engine/dom` are used by mcpify.js instead). Closing the panel stops the run.
Upload steps use the file chosen in the form, or the bundled demo sample (`dist/files/`).

## Dry run and the network guard
| Origin | Dry run | Network guard |
|---|---|---|
| Demo portals `http://localhost:5101-5103` | toggle, default **off** | optional when dry run is on (default on) |
| Any other origin | **forced on** | **forced on** |

- **Dry run** = engine `dryRun`: `commit` steps are never executed (`blocked_dry_run`, run ends `dry_run_complete`),
  plus the page banner "DRY RUN: nothing will be sent".
- **Network guard** = a `declarativeNetRequest` **session** rule scoped to the tab (`tabIds`) that blocks every
  `POST/PUT/PATCH/DELETE` (`requestMethods`) of every resource type, including form navigations (`main_frame`),
  to the tab's origin and any other host. It is removed when the run ends (and when the tab closes).
  On real sites even "Next" buttons post data, so a guarded run fills the first page and stops at the first
  page-changing POST (the tab shows Chrome's "blocked" page): nothing leaves the browser.
- **Counting blocked requests:** `declarativeNetRequest.onRuleMatchedDebug` gives a live log (method + URL) for
  unpacked extensions with `declarativeNetRequestFeedback` (how this extension is loaded). For a packed build the
  panel falls back to `getMatchedRules({ tabId })` after the run (count only). `webRequest` blocking is not
  available to MV3 extensions, so it is not used.

## Permissions (narrow on purpose)
`sidePanel`, `storage`, `scripting`, `activeTab`, `declarativeNetRequest`, `declarativeNetRequestFeedback`;
host permissions only for `http://localhost/*` and `http://127.0.0.1/*` (demo portals + local API).
Other sites work through `activeTab` (click the icon on the page) or `optional_host_permissions` granted per site.
No `tabs`, no `webRequest`, no remote code, no API keys.

## Chat mode (optional)
The Chat tab sends the conversation and the site's tools to `POST /agent/step` (API proxy to Claude), runs each
`tool_use` locally with the same run path (all pauses still go to you) and returns `tool_result`s. If the API
answers 503 the tab shows "Chat is not available". OTPs/CAPTCHAs never go to the model.

## Tests
`pnpm --filter @mcpify/extension test`
- `tests/unit.test.ts`: policy, DNR rule, form coercion, tool source fallback, remote driver retries, run controller, chat loop.
- `tests/extension.e2e.test.ts`: launches Chromium with the unpacked extension (`launchPersistentContext`,
  `channel: "chromium"`, headless), verifies the service worker and manifest, then drives the panel page
  (opened as a tab with `?tabId=<portal tab>`, because Playwright cannot click the toolbar icon) against
  Portal 1: forced dry-run + guard on a non-demo origin (POST blocked, nothing created), dry run on a demo
  origin (stops at Send OTP after two reloads), a full run with OTP/CAPTCHA typed into the panel, and chat 503.
  The test build adds the random-port test portal to the demo list via `buildExtension({ extraDemoOrigins })`;
  the shipped build has only ports 5101-5103.
