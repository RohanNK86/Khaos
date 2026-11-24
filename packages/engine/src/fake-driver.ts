import type { Locator } from "@mcpify/contracts";
import type { Driver } from "./types.js";

/** In-memory element for FakeDriver (unit tests only). */
export interface FakeElement {
  id?: string;
  testid?: string;
  name?: string;
  label?: string;
  text?: string;
  tag?: string;
  visible?: boolean;
  value?: string;
  error?: boolean;
  options?: string[];
  onClick?: (d: FakeDriver) => void;
}

/** Tiny DOM model: a URL plus a list of elements. Supports testid/id/name/label/text locators. */
export class FakeDriver implements Driver {
  currentUrl = "about:blank";
  elements: FakeElement[] = [];
  body = "";
  actions: string[] = [];

  constructor(init?: Partial<Pick<FakeDriver, "currentUrl" | "elements" | "body">>) {
    Object.assign(this, init);
  }

  private match(l: Locator): FakeElement[] {
    const vis = this.elements.filter((e) => e.visible !== false);
    switch (l.kind) {
      case "testid": return vis.filter((e) => e.testid === l.value);
      case "id": return vis.filter((e) => e.id === l.value);
      case "name": return vis.filter((e) => e.name === l.value);
      case "label": return vis.filter((e) => e.label?.toLowerCase() === l.value.toLowerCase());
      case "text": return vis.filter((e) => e.text === l.value);
      default: return [];
    }
  }
  async goto(url: string) { this.currentUrl = url; this.actions.push(`goto ${url}`); }
  async url() { return this.currentUrl; }
  async resolve(locators: Locator[]) {
    for (const l of locators) {
      const m = this.match(l);
      if (m.length === 1) return { handle: m[0], used: l };
    }
    return null;
  }
  async fill(el: unknown, v: string) { (el as FakeElement).value = v; this.actions.push(`fill ${(el as FakeElement).id} ${v}`); }
  async select(el: unknown, v: string) {
    const e = el as FakeElement;
    if (e.options && !e.options.includes(v)) throw new Error(`option "${v}" not found`);
    e.value = v;
    this.actions.push(`select ${e.id} ${v}`);
  }
  async check(el: unknown, on: boolean) { (el as FakeElement).value = String(on); this.actions.push(`check ${(el as FakeElement).id}`); }
  async click(el: unknown) { const e = el as FakeElement; this.actions.push(`click ${e.id}`); e.onClick?.(this); }
  async upload(el: unknown, f: { name: string }) { (el as FakeElement).value = f.name; this.actions.push(`upload ${f.name}`); }
  async value(el: unknown) { return (el as FakeElement).value ?? ""; }
  async text(el: unknown) { return (el as FakeElement).text ?? ""; }
  async isVisible(locators: Locator[]) { return (await this.resolve(locators)) !== null; }
  async pageText() { return this.body + " " + this.elements.map((e) => e.text ?? "").join(" "); }
  async hasErrorNear(el: unknown) { return (el as FakeElement).error === true; }
  async snapshot() { return `<html>${this.body}</html>`; }
  async waitForSettled() {}
  async errors() { return this.elements.filter((e) => e.error).map((e) => `${e.label}: invalid`); }
}
