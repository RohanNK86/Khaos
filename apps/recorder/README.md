# @mcpify/recorder: record a task once

```bash
pnpm --filter @mcpify/recorder record --site scholarship --task apply_scholarship [--url http://localhost:5101/apply/1] [--dry-run]
```
Opens a headed Chromium on the site (any slug in `fixtures/sites.json`; `--url` overrides the start page).
Do the task once, then press **Ctrl+Shift+S** in the page or type `done` in the terminal.

Output: a `Recording` (01-CONTRACTS §7), validated with `RecordingSchema`, saved to `recordings/<task>-<timestamp>.json`
(git-ignored) and `POST /recordings` when the API at `$API_URL` is up (snapshots are uploaded with `POST /blobs` first).
If the API is down it warns and stays local.

`--dry-run` aborts every request that could send data (non GET/HEAD/OPTIONS). Use it on real sites.

## What gets captured
- `click`, `input` (debounced, flushed before the next action), `change`, `submit`, `Enter`, plus `navigate` per main-frame navigation.
- An `ElementFingerprint` per target: label (`label[for]`, wrapping label, `aria-labelledby`, previous table cell), nearText, shortest unique cssPath, xpath, testid, `options` for `<select>`. Button inputs carry their value as `text`.
- `<select>` values are the **option label** (the engine selects by label). File inputs record the file name only.
- Masking happens **in the page**: password fields and anything whose label/name/id/placeholder matches `otp|captcha|password|pin|aadhaar|cvv` get `value: "•••"`.
- A DOM snapshot (`page.content()`) after each event, once the page settled, stored in the local blob dir (`$BLOB_DIR` or `.data/blobs`, same layout as `@mcpify/storage` FsBlobStore) and referenced by `domSnapshotBlobId`. A snapshot is kept only if the page was still on the event's URL. Typed values are DOM properties, so they never appear in snapshots.

## Noise collapsing (`collapseEvents`)
Repeated inputs/changes on one field merge into one event (first position, last value); label clicks and clicks on text fields, selects,
checkboxes and other non-clickable elements are dropped (the change event carries the value); a submit right after a button click is dropped;
Enter that triggered a submit/click is dropped; redirect chains keep the final navigation.

## Programmatic API (tests, compiler tests)
```ts
import { startRecording, finishRecording, LocalBlobStore } from '@mcpify/recorder';
const session = await startRecording(contextOrPage, { taskName: 'apply_scholarship', startUrl, blobs: new LocalBlobStore(dir) });
// ...drive session.page with Playwright...
const recording = await session.finish();           // or finishRecording()
```
Also exported: `CAPTURE_JS` / `installCapture` (the in-page script; also installs `window.__mcpifyFingerprint`), `collapseEvents`,
`saveRecording`, `publishRecording`, `loadSites`/`siteBySlug`/`siteByOrigin`, `installDryRunGuard`, `ROOT`/`fromRoot`/`fromUser`.

Tests: `pnpm --filter @mcpify/recorder test` (scripted session on a local page with `listen(0)`, Ctrl+Shift+S stop, collapse rules).
The full Portal 1 recording is exercised in `packages/compiler/tests/e2e.test.ts`.
