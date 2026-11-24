import type { Page } from "playwright";
import type { Locator } from "@mcpify/contracts";
import { IN_PAGE_JS } from "./in-page.js";
import type { Driver, ElementRef } from "./types.js";

export interface PlaywrightDriverOptions {
  /** Outline each element before acting and pause (for live demos). */
  showActions?: boolean;
  /** Pause after each action in ms when showActions is on. Default 350. */
  actionDelayMs?: number;
}

/** Driver over a Playwright page. Element refs are `data-mcpify-ref` attributes set by the in-page resolver. */
export function createPlaywrightDriver(page: Page, opts: PlaywrightDriverOptions = {}): Driver {
  const call = async <T>(expr: string): Promise<T> => page.evaluate(`(${IN_PAGE_JS}, ${expr})`) as Promise<T>;
  const api = (method: string, ...args: unknown[]) => `window.__mcpify.${method}(${args.map((a) => JSON.stringify(a)).join(",")})`;
  const sel = (el: ElementRef) => `[data-mcpify-ref="${String(el)}"]`;
  const delay = opts.actionDelayMs ?? 350;
  const show = async (el: ElementRef) => {
    if (!opts.showActions) return;
    await call(api("highlight", el)).catch(() => undefined);
    await page.waitForTimeout(delay);
  };

  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "load" });
    },
    async url() {
      return page.url();
    },
    async resolve(locators: Locator[]) {
      const r = await call<{ index: number; ref: string } | null>(api("resolve", locators));
      return r ? { handle: r.ref, used: locators[r.index]! } : null;
    },
    async fill(el, value) {
      await show(el);
      await page.locator(sel(el)).fill(value);
    },
    async select(el, labelOrValue) {
      await show(el);
      const i = await call<number>(api("optionIndex", el, labelOrValue));
      if (i < 0) throw new Error(`option "${labelOrValue}" not found`);
      await page.locator(sel(el)).selectOption({ index: i });
    },
    async check(el, on) {
      await show(el);
      await page.locator(sel(el)).setChecked(on);
    },
    async click(el) {
      await show(el);
      await page.locator(sel(el)).click();
    },
    async upload(el, file) {
      await show(el);
      await page.locator(sel(el)).setInputFiles({ name: file.name, mimeType: file.mime, buffer: Buffer.from(file.bytes) });
    },
    value: (el) => call<string>(api("value", el)),
    text: (el) => call<string>(api("text", el)),
    async isVisible(locators) {
      return (await call<unknown>(api("resolve", locators))) !== null;
    },
    pageText: () => page.evaluate("document.body ? document.body.innerText : ''") as Promise<string>,
    hasErrorNear: (el) => call<boolean>(api("hasErrorNear", el)),
    errors: () => call<string[]>(api("errors")),
    snapshot: () => page.content(),
    async waitForSettled(timeoutMs) {
      await page.waitForTimeout(50);
      await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => undefined);
    },
  };
}
