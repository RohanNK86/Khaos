import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ElementFingerprint, Locator } from '@mcpify/contracts';
import { IN_PAGE_JS } from '@mcpify/engine/in-page';
import { CAPTURE_JS } from '@mcpify/recorder';

export interface PageFacts {
  title: string;
  headings: string[];
  lines: string[];
  /** Visible fillable controls on the page. */
  controls: number;
}

export interface FoundOutput {
  label: string;
  value: string;
  target: ElementFingerprint;
}

/**
 * Helpers evaluated inside a loaded snapshot. Plain JS string so bundlers cannot inject helpers.
 * Uses the engine's resolver (window.__mcpify) so verification follows exactly the rules used at run time.
 */
const HELPERS_JS = String.raw`(() => {
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const visible = (el) => { const st = getComputedStyle(el); return st.display !== "none" && st.visibility !== "hidden" && el.getClientRects().length > 0; };
function findTarget(fp) {
  try {
    const x = document.evaluate(fp.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (x && x.tagName.toLowerCase() === fp.tag && (!fp.id || x.id === fp.id)) return x;
  } catch (e) {}
  if (fp.id) { const e = document.getElementById(fp.id); if (e) return e; }
  if (fp.name) { const es = document.getElementsByName(fp.name); if (es.length === 1) return es[0]; }
  try { const es = document.querySelectorAll(fp.cssPath); if (es.length === 1) return es[0]; } catch (e) {}
  return null;
}
function verify(locators, fp) {
  const target = fp ? findTarget(fp) : null;
  const ok = locators.map((loc) => {
    const r = window.__mcpify.resolve([loc]);
    if (!r) return false;
    return target ? window.__mcpify.el(r.ref) === target : true;
  });
  return { targetFound: Boolean(target), ok };
}
const HEADINGS = 'h1,h2,h3,h4,h5,h6,legend,caption,[class*="sec"],[class*="title"],[class*="head"],[class*="step"]';
function facts() {
  return {
    title: clean(document.title),
    headings: Array.from(document.querySelectorAll(HEADINGS)).filter(visible).map((e) => clean(e.innerText)).filter((t) => t && t.length <= 120),
    lines: (document.body ? document.body.innerText : "").split("\n").map(clean).filter(Boolean),
    controls: Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]),select,textarea')).filter(visible).length,
  };
}
const ID_RE = /^[A-Z]{2,6}[-\/]?\d{2,}(?:[-\/][A-Z0-9]+)*$/;
const KIND_RE = /(application|reference|registration|request|ticket|order|transaction|receipt|acknowledg|confirmation|booking|tracking)/i;
const ID_WORD_RE = /\b(id|no|number|ref)\b\.?/i;
function labelBefore(el) {
  const cell = el.closest("td,dd");
  if (cell && cell.previousElementSibling) return clean(cell.previousElementSibling.innerText);
  const block = el.closest("p,li,div,td,dd,span:not(:only-child)") || el.parentElement;
  if (!block) return "";
  const full = clean(block.innerText);
  const own = clean(el.innerText);
  const i = full.indexOf(own);
  return i > 0 ? full.slice(0, i) : "";
}
function outputs() {
  const found = [];
  for (const el of Array.from(document.body ? document.body.querySelectorAll("*") : [])) {
    if (el.children.length || !visible(el)) continue;
    const value = clean(el.innerText);
    if (!value || value.length > 40 || !/\d{3,}/.test(value) || /\s/.test(value)) continue;
    const label = labelBefore(el).replace(/[:#\s]+$/, "");
    let score = ID_RE.test(value) ? 2 : 0;
    if (KIND_RE.test(label)) score += 2;
    if (ID_WORD_RE.test(label)) score += 1;
    if (score >= 3 || (score === 2 && ID_RE.test(value))) found.push({ score, label, value, target: window.__mcpifyFingerprint(el) });
  }
  return found.sort((a, b) => b.score - a.score);
}
function formButton(fp) {
  const form = findTarget(fp);
  const btn = form && form.querySelector('input[type=submit],button[type=submit],button:not([type]),input[type=image]');
  return btn ? window.__mcpifyFingerprint(btn) : null;
}
function excerpt(fp, max) {
  const el = findTarget(fp);
  if (!el) return "";
  const box = el.closest("tr,li,.form-group,.field,p,div") || el.parentElement || el;
  return box.outerHTML.replace(/\s+/g, " ").slice(0, max);
}
window.__mcpifyCompiler = { verify, facts, outputs, formButton, excerpt };
})()`;

/**
 * Loads recorded DOM snapshots into a headless page (JavaScript off, network off) and answers questions about them.
 * One instance per compile; call close().
 */
export class SnapshotDom {
  private page: Page | null = null;
  private loadedId: string | null = null;
  private constructor(private browser: Browser, private context: BrowserContext, private load: (id: string) => Promise<string | null>) {}

  static async open(load: (blobId: string) => Promise<string | null>): Promise<SnapshotDom> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route('**/*', route => route.abort());
    return new SnapshotDom(browser, context, load);
  }

  /** Load a snapshot (fresh page each time so in-page state never leaks). False when the blob is missing. */
  private async use(blobId: string | undefined): Promise<boolean> {
    if (!blobId) return false;
    if (this.loadedId === blobId && this.page) return true;
    const html = await this.load(blobId);
    if (!html) return false;
    await this.page?.close();
    this.page = await this.context.newPage();
    await this.page.setContent(html, { waitUntil: 'domcontentloaded' });
    await this.page.evaluate(`${IN_PAGE_JS}; ${CAPTURE_JS}; ${HELPERS_JS}`);
    this.loadedId = blobId;
    return true;
  }

  private call<T>(expr: string): Promise<T> {
    return this.page!.evaluate(expr) as Promise<T>;
  }

  /** For each locator: does it resolve to exactly one visible element, and is that the recorded element? */
  async verify(blobId: string | undefined, locators: Locator[], target?: ElementFingerprint): Promise<{ ok: boolean[]; targetFound: boolean } | null> {
    if (!(await this.use(blobId))) return null;
    return this.call(`window.__mcpifyCompiler.verify(${JSON.stringify(locators)}, ${JSON.stringify(target ?? null)})`);
  }

  async facts(blobId: string | undefined): Promise<PageFacts | null> {
    if (!(await this.use(blobId))) return null;
    return this.call('window.__mcpifyCompiler.facts()');
  }

  /** Things that look like a generated reference (Application ID, Reference No, ...), best first. */
  async outputs(blobId: string | undefined): Promise<FoundOutput[]> {
    if (!(await this.use(blobId))) return [];
    return this.call('window.__mcpifyCompiler.outputs()');
  }

  /** Fingerprint of the submit button of a form (for `submit` events caused by Enter). */
  async formButton(blobId: string | undefined, form: ElementFingerprint): Promise<ElementFingerprint | null> {
    if (!(await this.use(blobId))) return null;
    return this.call(`window.__mcpifyCompiler.formButton(${JSON.stringify(form)})`);
  }

  /** Short HTML around the element (for the LLM pass; caller redacts). */
  async excerpt(blobId: string | undefined, target: ElementFingerprint, max = 600): Promise<string> {
    if (!(await this.use(blobId))) return '';
    return this.call(`window.__mcpifyCompiler.excerpt(${JSON.stringify(target)}, ${max})`);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
