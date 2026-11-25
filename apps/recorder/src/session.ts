import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import { RecordedEventSchema, RecordingSchema, type RecordedEvent, type Recording } from '@mcpify/contracts';
import { LocalBlobStore, type BlobWriter } from './blobs.js';
import { CAPTURE_JS } from './capture.js';
import { collapseEvents } from './collapse.js';

export interface RecordingOptions {
  taskName: string;
  /** Opened after the recorder is attached (recommended: it becomes the first `navigate` event). */
  startUrl?: string;
  /** Where DOM snapshots go. Default: local blob dir (FsBlobStore layout). `false` disables snapshots. */
  blobs?: BlobWriter | false;
  /** Wait before a snapshot so the page can settle. Default 250 ms. */
  settleMs?: number;
  /** Skip noise collapsing (raw events, for debugging). */
  raw?: boolean;
}

export interface RecordingSession {
  readonly context: BrowserContext;
  /** The page recording started on (a new one when a context was passed). */
  readonly page: Page;
  /** Resolves when the user pressed Ctrl+Shift+S in the page (or `stop()` was called). */
  readonly stopped: Promise<void>;
  stop(): void;
  /** Stop listening, wait for pending snapshots, collapse noise and return a validated Recording. */
  finish(): Promise<Recording>;
}

const isPage = (t: Page | BrowserContext): t is Page => 'mainFrame' in t;

/** page.content() of the document at `url`, or null when the page is elsewhere (or mid-navigation). */
async function grab(page: Page, url: string, state: 'domcontentloaded' | 'load'): Promise<string | null> {
  try {
    await page.waitForLoadState(state, { timeout: 5000 });
    if (page.url() !== url) return null;
    const html = await page.content();
    return page.url() === url ? html : null;
  } catch {
    return null;
  }
}

/**
 * Snapshot right away (fast scripted sessions may leave the page within milliseconds), then again once the
 * page settled; the settled one wins when the page is still on the event's URL.
 */
async function snapshotAfter(page: Page, url: string, settleMs: number): Promise<string | null> {
  const quick = await grab(page, url, 'domcontentloaded');
  await new Promise(r => setTimeout(r, settleMs));
  return (await grab(page, url, 'load')) ?? quick;
}

let current: RecordingSession | null = null;

/**
 * Attach the recorder to a Playwright page or context. Every user action becomes a RecordedEvent with an
 * ElementFingerprint, sensitive values masked in the page, and a DOM snapshot after the page settles.
 */
export async function startRecording(target: Page | BrowserContext, opts: RecordingOptions): Promise<RecordingSession> {
  const context = isPage(target) ? target.context() : target;
  const page = isPage(target) ? target : await context.newPage();
  const blobs = opts.blobs === false ? null : (opts.blobs ?? new LocalBlobStore());
  const settleMs = opts.settleMs ?? 250;
  const started = Date.now();
  const events: RecordedEvent[] = [];
  const pending: Promise<void>[] = [];
  let listening = true;
  let stopNow: () => void = () => undefined;
  const stopped = new Promise<void>(r => { stopNow = r; });

  const add = (p: Page, data: Omit<RecordedEvent, 'seq' | 't'>) => {
    if (!listening) return;
    const event = RecordedEventSchema.parse({ ...data, seq: events.length, t: Date.now() - started });
    events.push(event);
    if (!blobs) return;
    pending.push(snapshotAfter(p, event.url, settleMs).then(async html => {
      if (html) event.domSnapshotBlobId = await blobs.put(html, 'text/html');
    }).catch(() => undefined));
  };
  const watch = (p: Page) => p.on('framenavigated', frame => {
    if (frame === p.mainFrame() && /^https?:/.test(frame.url())) add(p, { type: 'navigate', url: frame.url() });
  });

  await context.exposeBinding('__mcpifyRecord', (source, raw: unknown) => add(source.page, raw as Omit<RecordedEvent, 'seq' | 't'>));
  await context.exposeBinding('__mcpifyStop', () => stopNow());
  await context.addInitScript({ content: CAPTURE_JS });
  for (const p of context.pages()) {
    watch(p);
    if (/^https?:/.test(p.url())) await p.evaluate(CAPTURE_JS).catch(() => undefined);
  }
  context.on('page', watch);
  if (opts.startUrl) await page.goto(opts.startUrl);

  const session: RecordingSession = {
    context, page, stopped,
    stop: () => stopNow(),
    async finish() {
      // let debounced inputs reach Node before we stop listening
      await page.evaluate('window.dispatchEvent(new Event("pagehide"))').catch(() => undefined);
      await new Promise(r => setTimeout(r, 50));
      listening = false;
      stopNow();
      await Promise.all(pending);
      const first = events.find(e => e.type === 'navigate');
      const startUrl = opts.startUrl ?? first?.url ?? page.url();
      if (current === session) current = null;
      return RecordingSchema.parse({
        id: randomUUID(), siteOrigin: new URL(startUrl).origin, startUrl, taskName: opts.taskName,
        events: opts.raw ? events : collapseEvents(events), createdAt: new Date().toISOString(),
      });
    },
  };
  current = session;
  return session;
}

/** Finish the given session, or the most recently started one. */
export async function finishRecording(session: RecordingSession | null = current): Promise<Recording> {
  if (!session) throw new Error('no recording in progress');
  return session.finish();
}
