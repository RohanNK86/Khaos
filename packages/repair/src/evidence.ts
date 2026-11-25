import type { Browser, BrowserContext, Page } from "playwright";
import type { Locator } from "@mcpify/contracts";
import { IN_PAGE_JS } from "@mcpify/engine/in-page";

/** Kinds of interactive elements a step can target. */
export type ElementKind = "text" | "select" | "check" | "file" | "button" | "link";

/** One visible interactive element of the evidence page (no field values: safe for the LLM after redaction). */
export interface Candidate {
  i: number;
  tag: string;
  type: string;
  kind: ElementKind;
  id: string;
  name: string;
  testid: string;
  labels: string[];      // normalised, as the engine's labelsOf sees them
  labelRaw: string;      // first label in original casing, `*`/`:` stripped
  text: string;          // buttons/links only
  nearText: string;
  form: string;
  required: boolean;
  options: { value: string; label: string }[];
}

/**
 * Plain-JS analysis helpers (a string, so no bundler helpers leak in). Requires window.__mcpify (IN_PAGE_JS).
 * Every visible control gets `data-mcpify-rx="<index>"` so locator resolution can be mapped back to a candidate.
 */
const ANALYSIS_JS = String.raw`(() => {
if (window.__mcpifyRepair) return window.__mcpifyRepair;
const M = window.__mcpify;
const CTRL = "input:not([type=hidden]),select,textarea,button,a[href],[role=button]";
const raw = (el) => (el ? (el.innerText || el.textContent || "") : "");
const clean = (s) => String(s || "").replace(/[*:]/g, " ").replace(/\s+/g, " ").trim();
const visible = (el) => {
  if (el.type === "file") return true;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none") return false;
  return el.getClientRects().length > 0;
};
function kindOf(el) {
  const t = el.tagName.toLowerCase(), ty = (el.getAttribute("type") || "").toLowerCase();
  if (t === "select") return "select";
  if (t === "textarea") return "text";
  if (t === "button" || el.getAttribute("role") === "button") return "button";
  if (t === "a") return "link";
  if (["submit", "button", "reset", "image"].includes(ty)) return "button";
  if (ty === "checkbox" || ty === "radio") return "check";
  if (ty === "file") return "file";
  return "text";
}
function labelCells(el) {
  const out = [];
  if (el.getAttribute("aria-label")) out.push(el.getAttribute("aria-label"));
  if (el.id) for (const l of document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]')) out.push({ l, cell: l.closest("td,th") || l });
  const w = el.closest("label"); if (w) out.push({ l: w, cell: w });
  const td = el.closest("td,th"); if (td && td.previousElementSibling) out.push({ l: td.previousElementSibling, cell: td.previousElementSibling });
  return out;
}
function labelRaw(el) {
  for (const x of labelCells(el)) { const s = clean(typeof x === "string" ? x : raw(x.l)); if (s) return s; }
  return clean(el.placeholder || "");
}
function required(el) {
  if (el.required || el.getAttribute("aria-required") === "true") return true;
  return labelCells(el).some((x) => typeof x !== "string" && /\*/.test(raw(x.cell)));
}
function nearText(el) {
  let best = "";
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,caption,[class^=sec],[class*=' sec']")) {
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = raw(h);
  }
  return clean(best).toLowerCase();
}
function formOf(el) {
  const f = el.form || el.closest("form");
  if (!f) return "";
  return Array.from(document.forms).indexOf(f) + ":" + (f.id || f.getAttribute("name") || f.getAttribute("action") || "");
}
function describe(el, i) {
  const kind = kindOf(el);
  const isBtn = kind === "button" || kind === "link";
  return {
    i, kind, tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") || "").toLowerCase(),
    id: el.id || "", name: el.getAttribute("name") || "",
    testid: el.getAttribute("data-testid") || el.getAttribute("data-mcpify") || "",
    labels: M.labelsOf(el), labelRaw: isBtn ? "" : labelRaw(el),
    text: isBtn ? clean(el.tagName === "INPUT" ? el.value : raw(el)) : "",
    nearText: nearText(el), form: formOf(el), required: !isBtn && required(el),
    options: el.tagName === "SELECT" ? Array.from(el.options).map((o) => ({ value: o.value, label: clean(o.text) })) : [],
  };
}
const api = {
  controls() {
    const els = Array.from(document.querySelectorAll(CTRL)).filter(visible);
    els.forEach((e, i) => e.setAttribute("data-mcpify-rx", String(i)));
    return els.map(describe);
  },
  /** Candidate index the locator list resolves to (exactly one visible match), -1 if none. */
  resolveIndex(locators) {
    const r = M.resolve(locators);
    if (!r) return -1;
    const v = M.el(r.ref).getAttribute("data-mcpify-rx");
    return v == null ? -2 : Number(v);
  },
  hasTestIds() { return document.querySelector("[data-mcpify],[data-testid]") !== null; },
};
window.__mcpifyRepair = api;
return api;
})()`;

/** Evidence DOM loaded into an isolated, offline Playwright page. */
export interface EvidencePage {
  candidates: Candidate[];
  hasTestIds: boolean;
  /** Candidate index of the first locator that resolves uniquely (engine semantics), -1 if none. */
  resolve(locators: Locator[]): Promise<number>;
  close(): Promise<void>;
}

/** Remove scripts and stale engine refs so the snapshot is inert and refs cannot collide. */
export function sanitizeEvidence(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\sdata-mcpify-(ref|rx)="[^"]*"/g, "");
}

export async function openEvidence(browser: Browser, html: string): Promise<EvidencePage> {
  const ctx: BrowserContext = await browser.newContext();
  await ctx.route("**/*", (r) => r.abort()); // offline: the snapshot must not reach any server
  const page: Page = await ctx.newPage();
  await page.setContent(sanitizeEvidence(html), { waitUntil: "domcontentloaded" });
  const call = <T>(expr: string) => page.evaluate(`(${IN_PAGE_JS}, ${ANALYSIS_JS}, ${expr})`) as Promise<T>;
  const candidates = await call<Candidate[]>("window.__mcpifyRepair.controls()");
  const hasTestIds = await call<boolean>("window.__mcpifyRepair.hasTestIds()");
  return {
    candidates,
    hasTestIds,
    resolve: (locators) => call<number>(`window.__mcpifyRepair.resolveIndex(${JSON.stringify(locators)})`),
    close: () => ctx.close(),
  };
}
