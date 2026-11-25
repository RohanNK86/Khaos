import type { Driver, FileBlob } from "@mcpify/engine";
import { toBase64, type CallMessage, type ContentMessage, type DriverMethod, type Reply, type WireFile } from "./protocol.js";

/** How the panel reaches one tab. `chromeTransport` is the real one; tests pass fakes. */
export interface TabTransport {
  send(msg: ContentMessage): Promise<Reply>;
  /** Inject the content script (idempotent). */
  inject(): Promise<void>;
  navigate(url: string): Promise<void>;
  status(): Promise<"loading" | "complete" | "unloaded" | undefined>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The message never reached a content script (none injected yet, or the page is loading). */
const NOT_DELIVERED = /Receiving end does not exist|Could not establish connection/i;
/** The page went away after receiving the message (a click navigated). */
const GONE_AFTER = /message port closed|Frame with ID 0 was removed|back\/forward cache/i;

/**
 * Driver that runs the engine in the side panel and every DOM operation in the tab's content script.
 * Survives page reloads: a failed send waits for the tab to finish loading, re-injects and retries once.
 */
export function createRemoteDriver(t: TabTransport, opts: { banner: boolean; settleTimeoutMs?: number }): Driver {
  const waitComplete = async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && (await t.status().catch(() => undefined)) !== "complete") await sleep(100);
  };
  const send = async (method: DriverMethod, args: unknown[]): Promise<unknown> => {
    const msg: CallMessage = { kind: "mcpify:call", method, args, banner: opts.banner };
    let r = await t.send(msg).catch((e: unknown) => ({ ok: false as const, error: String(e instanceof Error ? e.message : e) }));
    if (!r.ok && (NOT_DELIVERED.test(r.error) || GONE_AFTER.test(r.error))) {
      if (method === "click" && GONE_AFTER.test(r.error)) return undefined; // the click navigated before replying: success
      await waitComplete(opts.settleTimeoutMs ?? 8000);
      await t.inject().catch(() => undefined);
      r = await t.send(msg).catch((e: unknown) => ({ ok: false as const, error: String(e instanceof Error ? e.message : e) }));
    }
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const wireFile = (f: FileBlob): WireFile => ({ name: f.name, mime: f.mime, base64: toBase64(f.bytes) });

  return {
    async goto(url) {
      await t.navigate(url);
    },
    url: () => send("url", []) as Promise<string>,
    resolve: (locators) => send("resolve", [locators]) as ReturnType<Driver["resolve"]>,
    fill: async (el, value) => { await send("fill", [el, value]); },
    select: async (el, v) => { await send("select", [el, v]); },
    check: async (el, on) => { await send("check", [el, on]); },
    click: async (el) => { await send("click", [el]); },
    upload: async (el, file) => { await send("upload", [el, wireFile(file)]); },
    value: (el) => send("value", [el]) as Promise<string>,
    text: (el) => send("text", [el]) as Promise<string>,
    isVisible: (locators) => send("isVisible", [locators]) as Promise<boolean>,
    pageText: () => send("pageText", []) as Promise<string>,
    hasErrorNear: (el) => send("hasErrorNear", [el]) as Promise<boolean>,
    snapshot: () => send("snapshot", []) as Promise<string>,
    errors: () => send("errors", []) as Promise<string[]>,
    async waitForSettled(timeoutMs) {
      await sleep(150); // let a click start its navigation
      await waitComplete(timeoutMs);
    },
  };
}

/** The real transport over chrome.tabs / chrome.scripting. */
export function chromeTransport(tabId: number): TabTransport {
  return {
    send: (msg) => chrome.tabs.sendMessage<ContentMessage, Reply>(tabId, msg, { frameId: 0 }).then((r) => r ?? { ok: false, error: "Receiving end does not exist" }),
    async inject() {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"] });
    },
    async navigate(url) {
      await chrome.tabs.update(tabId, { url });
    },
    async status() {
      return (await chrome.tabs.get(tabId)).status as "loading" | "complete" | "unloaded" | undefined;
    },
  };
}
