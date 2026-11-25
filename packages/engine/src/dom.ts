import {
  RunSchema, redactInputs, sensitiveParams,
  type Locator, type Run, type RunMode, type StepTrace, type Tool,
} from "@mcpify/contracts";
import { evalAllUntil } from "./conditions.js";
import { IN_PAGE_JS } from "./in-page.js";
import { runTool } from "./run.js";
import type { Driver, ElementRef, FileBlob, RunHooks } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. The in-page resolver (shared with the Playwright driver through IN_PAGE_JS)
// ─────────────────────────────────────────────────────────────────────────────

/** The `window.__mcpify` API installed by IN_PAGE_JS. Element refs are `data-mcpify-ref` values. */
export interface InPageApi {
  resolve(locators: Locator[]): { index: number; ref: string } | null;
  el(ref: string): Element | null;
  value(ref: string): string;
  text(ref: string): string;
  optionIndex(ref: string, want: string): number;
  hasErrorNear(ref: string): boolean;
  errors(): string[];
  highlight(ref: string): void;
}

/** Installs (or returns the already installed) in-page API in a window. */
/** A browser window with its globals (Event, File, CSS…), as `doc.defaultView` is at runtime. */
export type Win = Window & typeof globalThis;

export type InPageInstaller = (win: Win) => InPageApi;

/**
 * Default installer: evaluates IN_PAGE_JS once with the window's globals.
 * Bundles that run under a strict CSP (content scripts, mcpify.js) should pass an installer
 * generated at build time instead (see apps/extension/build.mjs), because this one needs `new Function`.
 */
export const evalInstaller: InPageInstaller = (win) => {
  const w = win as Win & { __mcpify?: InPageApi };
  if (w.__mcpify) return w.__mcpify;
  const factory = new Function("window", "document", "getComputedStyle", "CSS", "Node", "XPathResult", `return ${IN_PAGE_JS};`);
  return factory(win, win.document, win.getComputedStyle.bind(win), win.CSS, win.Node, (win as { XPathResult?: unknown }).XPathResult) as InPageApi;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. DomDriver
// ─────────────────────────────────────────────────────────────────────────────

export interface DomDriverOptions {
  install?: InPageInstaller;
  /** Outline each element before acting (live demos). */
  highlight?: boolean;
  /** Pause after highlighting, in ms. Default 250. */
  actionDelayMs?: number;
  /** Called right before an action that may unload the page (click, goto). Persist resume state here. */
  onBeforeNavigation?: () => void | Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Driver over a live Document with plain DOM APIs (in the page, a content script, or happy-dom). */
export function createDomDriver(doc: Document, opts: DomDriverOptions = {}): Driver {
  const win = doc.defaultView as Win | null;
  if (!win) throw new Error("createDomDriver needs a document attached to a window");
  const api = () => (opts.install ?? evalInstaller)(win);
  const el = (ref: ElementRef) => {
    const e = api().el(String(ref));
    if (!e) throw new Error(`element ${String(ref)} is gone`);
    return e as HTMLElement;
  };
  let unloading = false;
  win.addEventListener("beforeunload", () => { unloading = true; });
  win.addEventListener("pagehide", () => { unloading = true; });
  const show = async (ref: ElementRef) => {
    if (!opts.highlight) return;
    api().highlight(String(ref));
    await sleep(opts.actionDelayMs ?? 250);
  };

  return {
    async goto(url) {
      if (sameDocumentUrl(win.location.href, url)) return; // already there: no reload
      await opts.onBeforeNavigation?.();
      win.location.assign(url);
    },
    async url() {
      return win.location.href;
    },
    async resolve(locators) {
      const r = api().resolve(locators);
      return r ? { handle: r.ref, used: locators[r.index]! } : null;
    },
    async fill(ref, value) {
      await show(ref);
      setNativeValue(win, el(ref), value);
    },
    async select(ref, labelOrValue) {
      await show(ref);
      const i = api().optionIndex(String(ref), labelOrValue);
      if (i < 0) throw new Error(`option "${labelOrValue}" not found`);
      const sel = el(ref) as HTMLSelectElement;
      sel.selectedIndex = i;
      fire(win, sel, "input", "change");
    },
    async check(ref, on) {
      await show(ref);
      const box = el(ref) as HTMLInputElement;
      if (box.checked !== on) box.click();
      if (box.checked !== on) {
        box.checked = on;
        fire(win, box, "input", "change");
      }
    },
    async click(ref) {
      await show(ref);
      await opts.onBeforeNavigation?.();
      el(ref).click();
    },
    async upload(ref, file) {
      await show(ref);
      setFiles(win, el(ref) as HTMLInputElement, file);
    },
    value: async (ref) => api().value(String(ref)),
    text: async (ref) => api().text(String(ref)),
    isVisible: async (locators) => api().resolve(locators) !== null,
    pageText: async () => (doc.body ? doc.body.innerText ?? doc.body.textContent ?? "" : ""),
    hasErrorNear: async (ref) => api().hasErrorNear(String(ref)),
    errors: async () => api().errors(),
    snapshot: async () => `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
    async waitForSettled(timeoutMs) {
      await sleep(60);
      // A click started a navigation: this JS context is about to die. Wait (bounded) so the
      // engine never acts on the old page; the run resumes on the next page from saved state.
      if (unloading) return sleep(timeoutMs);
      const deadline = Date.now() + timeoutMs;
      while (doc.readyState !== "complete" && Date.now() < deadline) await sleep(50);
    },
  };
}

function sameDocumentUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b, a);
    x.hash = "";
    y.hash = "";
    return x.href === y.href;
  } catch {
    return false;
  }
}

function fire(win: Win, target: Element, ...types: string[]) {
  for (const t of types) target.dispatchEvent(new win.Event(t, { bubbles: true }));
}

/** Use the prototype's value setter so framework-controlled inputs (React etc.) see the change. */
function setNativeValue(win: Win, target: HTMLElement, value: string) {
  const w = win as unknown as Record<string, { prototype: object } | undefined>;
  const proto = target.tagName === "TEXTAREA" ? w.HTMLTextAreaElement : target.tagName === "SELECT" ? w.HTMLSelectElement : w.HTMLInputElement;
  const setter = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
  target.focus?.();
  if (setter) setter.call(target, value);
  else (target as HTMLInputElement).value = value;
  fire(win, target, "input", "change");
  target.blur?.();
}

function setFiles(win: Win, input: HTMLInputElement, file: FileBlob) {
  const f = new win.File([file.bytes as BlobPart], file.name, { type: file.mime });
  const dt = new win.DataTransfer();
  dt.items.add(f);
  input.files = dt.files;
  fire(win, input, "input", "change");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Resume across page reloads
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal storage: `window.sessionStorage` fits as is; wrap chrome.storage.session with `keyValueStorage`. */
export interface RunStateStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** Adapter for promise-based key/value areas such as `chrome.storage.session`. */
export function keyValueStorage(area: {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}): RunStateStorage {
  return {
    getItem: async (k) => {
      const v = (await area.get(k))[k];
      return typeof v === "string" ? v : null;
    },
    setItem: (k, v) => area.set({ [k]: v }),
    removeItem: (k) => area.remove(k),
  };
}

/** What survives a reload. Never contains sensitive values (passwords, OTPs, CAPTCHAs). */
export interface PersistedRunState {
  v: 1;
  runId: string;
  toolId: string;
  toolVersion: number;
  /** Index of the step whose action was the last thing done before the reload. */
  stepIndex: number;
  /** Set when that step's action ran but its post conditions were not verified yet. */
  pendingStepId?: string;
  /** Inputs minus sensitive params. */
  inputs: Record<string, unknown>;
  /** Sensitive params the caller supplied; they are asked for again after a reload. */
  sensitiveKeys: string[];
  committedStepIds: string[];
  dryRun: boolean;
  mode: RunMode;
  /** The run so far (redacted inputs, trace, outputs). */
  run: Run;
  savedAt: number;
}

export const DEFAULT_RUN_STATE_KEY = "mcpify:run";
const MAX_STATE_AGE_MS = 15 * 60 * 1000;

function defaultStorage(): RunStateStorage {
  const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (!s) throw new Error("no sessionStorage here: pass a RunStateStorage");
  return s;
}

export async function persistRunState(state: PersistedRunState, storage: RunStateStorage = defaultStorage(), key = DEFAULT_RUN_STATE_KEY) {
  await storage.setItem(key, JSON.stringify(state));
}

export async function clearRunState(storage: RunStateStorage = defaultStorage(), key = DEFAULT_RUN_STATE_KEY) {
  await storage.removeItem(key);
}

/** Load and validate saved state; returns null if absent, malformed or stale. */
export async function loadRunState(storage: RunStateStorage = defaultStorage(), key = DEFAULT_RUN_STATE_KEY): Promise<PersistedRunState | null> {
  const raw = await storage.getItem(key);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as PersistedRunState;
    const ok = s.v === 1 && typeof s.runId === "string" && typeof s.toolId === "string" && Number.isInteger(s.stepIndex)
      && Array.isArray(s.committedStepIds) && Array.isArray(s.sensitiveKeys) && typeof s.inputs === "object"
      && RunSchema.safeParse(s.run).success && Date.now() - s.savedAt < MAX_STATE_AGE_MS;
    return ok ? s : null;
  } catch {
    return null;
  }
}

export interface InPageRunOptions {
  dryRun: boolean;
  mode: RunMode;
  runId?: string;
  signal?: AbortSignal;
  storage?: RunStateStorage;
  storageKey?: string;
  driver?: Omit<DomDriverOptions, "onBeforeNavigation">;
}

/** Fresh run in this document that survives page reloads (call `resumeToolInPage` on the next page). */
export function runToolInPage(tool: Tool, inputs: Record<string, unknown>, doc: Document, hooks: RunHooks, opts: InPageRunOptions): Promise<Run> {
  const runId = opts.runId ?? newRunId();
  const sensitive = sensitiveParams(tool);
  const base: PersistedRunState = {
    v: 1, runId, toolId: tool.id, toolVersion: tool.version, stepIndex: 0,
    inputs: Object.fromEntries(Object.entries(inputs).filter(([k]) => !sensitive.has(k))),
    sensitiveKeys: Object.keys(inputs).filter((k) => sensitive.has(k)),
    committedStepIds: [], dryRun: opts.dryRun, mode: opts.mode,
    run: { ...emptyRun(tool, runId, opts), inputsRedacted: redactInputs(tool, inputs) }, savedAt: Date.now(),
  };
  return drive(tool, inputs, doc, hooks, opts, base, 0, {});
}

/**
 * Continue a run after a reload: verify the post conditions of the step that navigated,
 * re-ask sensitive inputs, then run the remaining steps with `startIndex` + `committedStepIds`.
 */
export async function resumeToolInPage(tool: Tool, state: PersistedRunState, doc: Document, hooks: RunHooks, opts: Omit<InPageRunOptions, "dryRun" | "mode" | "runId">): Promise<Run> {
  const storage = opts.storage ?? defaultStorage();
  const fail = (status: Run["status"], error: string) =>
    finishRun(storage, opts.storageKey, { ...state.run, status, endedAt: new Date().toISOString() }, error);
  if (tool.id !== state.toolId || tool.version !== state.toolVersion) return fail("failed", "tool changed during the run");
  const outputs: Record<string, string> = { ...state.run.outputs };
  const inputs: Record<string, unknown> = { ...state.inputs };
  const prior = [...state.run.trace];
  let next = state.stepIndex;
  const step = tool.steps[state.stepIndex];
  if (state.pendingStepId && step?.id === state.pendingStepId) {
    const t = await verifyPending(step, doc, inputs, outputs, opts);
    prior.push(t);
    hooks.onStep?.(t);
    if (t.status === "failed") {
      return finishRun(storage, opts.storageKey, { ...state.run, trace: prior, outputs, status: "failed", failedStepId: step.id, endedAt: new Date().toISOString() });
    }
    next = state.stepIndex + 1;
  }
  for (const key of state.sensitiveKeys) {
    const title = (tool.inputSchema.properties as Record<string, { title?: string }> | undefined)?.[key]?.title ?? key;
    const ans = await hooks.onNeed({ kind: "user_input", stepId: tool.steps[next]?.id ?? "resume", param: key, prompt: `The page reloaded. Please enter "${title}" again to continue.`, sensitive: true });
    if (!ans.value) return fail("stopped", "no value was given");
    inputs[key] = ans.value;
  }
  return drive(tool, inputs, doc, hooks, { ...opts, dryRun: state.dryRun, mode: state.mode, runId: state.runId },
    { ...state, run: { ...state.run, trace: prior, outputs } }, next, outputs);
}

async function verifyPending(step: Tool["steps"][number], doc: Document, inputs: Record<string, unknown>, outputs: Record<string, string>, opts: Pick<InPageRunOptions, "driver" | "signal">): Promise<StepTrace> {
  const t0 = Date.now();
  const driver = createDomDriver(doc, opts.driver);
  const post = await evalAllUntil(step.post, driver, inputs, outputs, step.timeoutMs ?? 8000, opts.signal);
  const trace: StepTrace = {
    stepId: step.id, status: post.ok ? "passed" : "failed", preResults: [], postResults: post.results,
    startedAt: new Date(t0).toISOString(), durationMs: Date.now() - t0,
  };
  if (!post.ok) trace.error = `postcondition failed after reload: ${post.results.filter((r) => !r.ok).map((r) => r.detail).join("; ")}`;
  return trace;
}

async function drive(
  tool: Tool, inputs: Record<string, unknown>, doc: Document, hooks: RunHooks,
  opts: InPageRunOptions, base: PersistedRunState, startIndex: number, priorOutputs: Record<string, string>,
): Promise<Run> {
  const storage = opts.storage ?? defaultStorage();
  let current = startIndex;
  const liveTrace: StepTrace[] = [...base.run.trace];
  const committed = new Set(base.committedStepIds);
  const driver = createDomDriver(doc, {
    ...opts.driver,
    onBeforeNavigation: async () => {
      const step = tool.steps[current];
      if (!step) return;
      if (step.risk === "commit") committed.add(step.id);
      await persistRunState({
        ...base, stepIndex: current, pendingStepId: step.id, committedStepIds: [...committed],
        run: { ...base.run, trace: [...liveTrace], outputs: { ...priorOutputs } }, savedAt: Date.now(),
      }, storage, opts.storageKey);
    },
  });
  const wrapped: RunHooks = {
    ...hooks,
    onStep(t) {
      if (t.status !== "awaiting") {
        liveTrace.push(t);
        current++;
      }
      hooks.onStep?.(t);
    },
  };
  const run = await runTool(tool, inputs, driver, wrapped, {
    dryRun: opts.dryRun, mode: opts.mode, runId: base.runId, signal: opts.signal,
    startIndex, committedStepIds: [...committed],
  });
  return finishRun(storage, opts.storageKey, {
    ...run, startedAt: base.run.startedAt, inputsRedacted: base.run.inputsRedacted,
    trace: [...base.run.trace, ...run.trace], outputs: { ...priorOutputs, ...run.outputs },
  });
}

async function finishRun(storage: RunStateStorage, key: string | undefined, run: Run, error?: string): Promise<Run> {
  await clearRunState(storage, key);
  if (error) run.trace = [...run.trace, { stepId: "resume", status: "failed", preResults: [], postResults: [], startedAt: new Date().toISOString(), durationMs: 0, error }];
  return run;
}

function emptyRun(tool: Tool, runId: string, opts: InPageRunOptions): Run {
  return {
    id: runId, toolId: tool.id, toolVersion: tool.version, mode: opts.mode, dryRun: opts.dryRun, status: "running",
    inputsRedacted: {}, outputs: {}, trace: [], startedAt: new Date().toISOString(),
  };
}

/** uuid v4; works outside secure contexts where crypto.randomUUID is missing. */
export function newRunId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
