/** Side panel UI: tools for the active tab, form, run timeline, pauses, outputs, chat, settings. */
import type { Need, Run, StepTrace, Tool } from "@mcpify/contracts";
import type { FileBlob, NeedAnswer, RunHooks } from "@mcpify/engine";
import { chatTurn, ChatUnavailable, type ChatMessage } from "./chat.js";
import { executeRun, reportRun, type RunResult } from "./controller.js";
import { coerceInputs, formFields, type FormField, type RawValues } from "./form.js";
import { createGuard, type BlockedRequest } from "./guard.js";
import { effectiveSafety, originOf, policyFor, type DryRunPolicy } from "./policy.js";
import { chromeTransport, createRemoteDriver } from "./remote-driver.js";
import { DEFAULT_API_BASE, loadTools, type ToolSource } from "./tools-source.js";
import { h, mount } from "./ui.js";

interface State {
  tabId: number | null;
  origin: string | null;
  policy: DryRunPolicy;
  apiBase: string;
  source: ToolSource;
  tab: "tools" | "chat" | "settings";
  dryRun: boolean;
  strictGuard: boolean;
  tool: Tool | null;
  values: RawValues;
  files: Map<string, FileBlob>;
  errors: Record<string, string>;
  running: boolean;
  traces: Map<string, StepTrace>;
  need: { need: Need; answer: (a: NeedAnswer) => void } | null;
  blocked: BlockedRequest[];
  result: RunResult | null;
  runError: string | null;
  chat: ChatMessage[];
  chatLog: { who: "user" | "assistant" | "system"; text: string }[];
  chatDisabled: string | null;
}

const fixedTabId = Number(new URLSearchParams(location.search).get("tabId")) || null;
const app = document.getElementById("app")!;
const s: State = {
  tabId: null, origin: null, policy: policyFor(null), apiBase: DEFAULT_API_BASE, source: { source: "none", site: null, tools: [] },
  tab: "tools", dryRun: true, strictGuard: true, tool: null, values: {}, files: new Map(), errors: {}, running: false,
  traces: new Map(), need: null, blocked: [], result: null, runError: null, chat: [], chatLog: [], chatDisabled: null,
};
let abort: AbortController | null = null;

const render = () => mount(app, view());

// ── data ─────────────────────────────────────────────────────────────────────
async function refreshTab() {
  if (s.running) return;
  const tab = fixedTabId ? await chrome.tabs.get(fixedTabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const origin = originOf(tab?.url);
  const changed = origin !== s.origin || tab?.id !== s.tabId;
  s.tabId = tab?.id ?? null;
  s.origin = origin;
  if (!changed) return;
  s.policy = policyFor(origin);
  s.dryRun = s.policy.dryRunDefault;
  s.strictGuard = true;
  s.tool = null;
  s.result = null;
  s.source = origin ? await loadTools(s.apiBase, origin) : { source: "none", site: null, tools: [] };
  render();
}

async function loadFile(ref: string): Promise<FileBlob> {
  const chosen = s.files.get(ref);
  if (chosen) return chosen;
  const r = await fetch(chrome.runtime.getURL(`files/${encodeURIComponent(ref)}`)).catch(() => null);
  if (!r?.ok) throw new Error(`choose the file "${ref}" in the form first`);
  const mime = ref.endsWith(".pdf") ? "application/pdf" : ref.endsWith(".png") ? "image/png" : "application/octet-stream";
  return { name: ref, mime, bytes: new Uint8Array(await r.arrayBuffer()) };
}

// ── running ──────────────────────────────────────────────────────────────────
function hooks(): RunHooks {
  return {
    onNeed: (need) => new Promise((resolve) => {
      s.need = { need, answer: (a) => { s.need = null; resolve(a); render(); } };
      render();
    }),
    onStep: (t) => { s.traces.set(t.stepId, t); render(); },
    loadFile,
  };
}

async function startRun(tool: Tool, inputs: Record<string, unknown>): Promise<RunResult | null> {
  if (s.tabId === null || s.running) return null;
  const safety = effectiveSafety(s.policy, { dryRun: s.dryRun, strictGuard: s.strictGuard });
  const tabId = s.tabId;
  Object.assign(s, { running: true, traces: new Map(), blocked: [], result: null, runError: null, tool });
  abort = new AbortController();
  render();
  const transport = chromeTransport(tabId);
  const guard = createGuard(tabId, (b) => { s.blocked.push(b); render(); });
  try {
    s.result = await executeRun(tool, inputs, safety, {
      driver: createRemoteDriver(transport, { banner: safety.dryRun }),
      guard,
      banner: async (on) => { await transport.send({ kind: "mcpify:banner", on }); },
      report: (run) => reportRun(s.apiBase, run),
    }, hooks(), abort.signal);
    return s.result;
  } catch (e) {
    s.runError = e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    s.running = false;
    s.need = null;
    abort = null;
    render();
  }
}

function submitForm(tool: Tool) {
  const { inputs, errors } = coerceInputs(formFields(tool), s.values);
  s.errors = errors;
  if (Object.keys(errors).length) return render();
  void startRun(tool, inputs);
}

async function sendChat(text: string) {
  s.chatLog.push({ who: "user", text });
  render();
  try {
    s.chat = await chatTurn(s.chat, text, {
      apiBase: s.apiBase, tools: s.source.tools,
      onAssistantText: (t) => { s.chatLog.push({ who: "assistant", text: t }); render(); },
      execute: async (tool, input) => {
        const r = await startRun(tool, input);
        if (!r) return { text: JSON.stringify({ error: s.runError ?? "the run could not start" }), isError: true };
        return { text: JSON.stringify({ run_id: r.run.id, status: r.run.status, outputs: r.run.outputs, blocked_requests: r.blocked }), isError: r.run.status === "failed" };
      },
    });
  } catch (e) {
    if (e instanceof ChatUnavailable) s.chatDisabled = e.message;
    else s.chatLog.push({ who: "system", text: e instanceof Error ? e.message : String(e) });
  }
  render();
}

// ── views ────────────────────────────────────────────────────────────────────
function view(): Node[] {
  return [header(), safetyCard(), tabs(), s.tab === "tools" ? toolsView() : s.tab === "chat" ? chatView() : settingsView(), ...(s.running || s.result || s.runError ? [runView()] : [])];
}

function header() {
  const src = s.source.source;
  return h("header", {}, [
    h("div", { class: "brand" }, [h("span", { class: "logo" }, "MCPify"), h("h1", {}, "Tools for this site")]),
    h("div", { class: "row muted" }, [
      h("span", { "data-testid": "origin" }, s.origin ?? "No web page in this tab"),
      h("span", { class: `badge ${src === "api" ? "" : "warn"}`, "data-testid": "source" }, src === "api" ? "from API" : src === "bundled" ? "bundled demo tools" : "no tools"),
    ]),
  ]);
}

function safetyCard() {
  const p = s.policy;
  const eff = effectiveSafety(p, { dryRun: s.dryRun, strictGuard: s.strictGuard });
  return h("section", { class: "card" }, [
    h("label", { class: "row" }, [
      h("input", { type: "checkbox", "data-testid": "dry-run", checked: eff.dryRun, disabled: p.dryRunForced || s.running, onchange: (e: Event) => { s.dryRun = (e.target as HTMLInputElement).checked; render(); } }),
      h("b", {}, "Dry run"), h("span", { class: "muted" }, p.dryRunForced ? "(always on outside the demo portals)" : "(fill only, skip every send)"),
    ]),
    h("label", { class: "row" }, [
      h("input", { type: "checkbox", "data-testid": "strict-guard", checked: eff.strictGuard, disabled: p.guardForced || !eff.dryRun || s.running, onchange: (e: Event) => { s.strictGuard = (e.target as HTMLInputElement).checked; render(); } }),
      h("b", {}, "Network guard"), h("span", { class: "muted" }, "block every POST/PUT/PATCH/DELETE from this tab"),
    ]),
  ]);
}

function tabs() {
  const tab = (id: State["tab"], label: string) =>
    h("button", { "aria-pressed": String(s.tab === id), "data-testid": `tab-${id}`, onclick: () => { s.tab = id; render(); } }, label);
  return h("nav", { class: "tabs" }, [tab("tools", "Tools"), tab("chat", "Chat"), tab("settings", "Settings")]);
}

function toolsView() {
  if (!s.origin) return h("section", { class: "card" }, "Open a website in this tab. If the page is not on localhost, click the MCPify icon on it to give access.");
  if (!s.source.tools.length) return h("section", { class: "card" }, [h("p", {}, "No approved MCPify tools for this site yet."), h("p", { class: "muted" }, `Checked ${s.apiBase}/sites/manifest and the bundled demo tools.`)]);
  if (s.tool && !s.running && !s.result) return formView(s.tool);
  return h("section", {}, s.source.tools.map((t) =>
    h("button", { class: "tool", "data-testid": `tool-${t.name}`, disabled: s.running, onclick: () => { Object.assign(s, { tool: t, values: defaults(t), errors: {}, result: null, runError: null }); render(); } }, [
      h("span", {}, t.title), h("small", {}, t.description),
    ])));
}

function defaults(t: Tool): RawValues {
  return Object.fromEntries(formFields(t).flatMap((f) => (f.defaultValue !== undefined ? [[f.key, f.defaultValue]] : [])));
}

function fieldInput(f: FormField) {
  const set = (v: string | boolean) => { s.values[f.key] = v; };
  const common = { "data-field": f.key, "aria-label": f.title };
  if (f.kind === "boolean") return h("input", { ...common, type: "checkbox", checked: s.values[f.key] === true, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) });
  if (f.kind === "enum") {
    return h("select", { ...common, onchange: (e: Event) => set((e.target as HTMLSelectElement).value) },
      [h("option", { value: "" }, "Choose…"), ...(f.options ?? []).map((o) => h("option", { value: o, selected: s.values[f.key] === o }, o))]);
  }
  if (f.kind === "file") {
    return h("input", {
      ...common, type: "file", onchange: async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        s.values[f.key] = file.name;
        s.files.set(file.name, { name: file.name, mime: file.type || "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()) });
      },
    });
  }
  const type = f.kind === "integer" || f.kind === "number" ? "number" : f.kind === "date" ? "date" : f.kind === "email" ? "email" : f.sensitive ? "password" : "text";
  return h("input", { ...common, type, value: String(s.values[f.key] ?? ""), oninput: (e: Event) => set((e.target as HTMLInputElement).value) });
}

function formView(t: Tool) {
  return h("section", { class: "card" }, [
    h("h2", {}, t.title),
    h("p", { class: "muted" }, t.description),
    h("form", { onsubmit: (e: Event) => { e.preventDefault(); submitForm(t); } }, [
      ...formFields(t).map((f) => h("label", { class: "field" }, [
        f.kind === "boolean" ? h("span", { class: "row" }, [fieldInput(f), f.title]) : f.title + (f.required ? " *" : ""),
        f.kind === "boolean" ? null : fieldInput(f),
        f.description ? h("small", {}, f.kind === "file" ? `${f.description}. Default: ${String(f.defaultValue ?? "none")} (bundled sample)` : f.description) : null,
        s.errors[f.key] ? h("span", { class: "err" }, s.errors[f.key]!) : null,
      ])),
      h("div", { class: "row" }, [
        h("button", { type: "submit", class: "primary", "data-testid": "run" }, effectiveSafety(s.policy, { dryRun: s.dryRun, strictGuard: s.strictGuard }).dryRun ? "Dry run in this tab" : "Run in this tab"),
        h("button", { type: "button", onclick: () => { s.tool = null; render(); } }, "Back"),
      ]),
    ]),
  ]);
}

function needView() {
  const n = s.need;
  if (!n) return null;
  if (n.need.kind === "confirmation") {
    return h("div", { class: "card need", "data-testid": "need" }, [
      h("h3", {}, "Confirm before sending"),
      h("p", {}, "The next step sends these details to the website:"),
      h("dl", {}, n.need.preview.flatMap((p) => [h("dt", {}, p.label), h("dd", {}, p.value)])),
      h("div", { class: "row" }, [
        h("button", { class: "primary", "data-testid": "approve", onclick: () => n.answer({ approve: true }) }, "Confirm and send"),
        h("button", { "data-testid": "reject", onclick: () => n.answer({ approve: false }) }, "Cancel"),
      ]),
    ]);
  }
  const need = n.need;
  let value = "";
  return h("form", { class: "card need", "data-testid": "need", onsubmit: (e: Event) => { e.preventDefault(); n.answer({ value }); } }, [
    h("h3", {}, need.param === "captcha" ? "Type the CAPTCHA" : need.param === "otp" ? "Type the OTP" : "Your input"),
    h("p", {}, need.prompt),
    h("input", { "data-testid": "need-input", type: need.sensitive ? "password" : "text", autocomplete: "one-time-code", required: true, oninput: (e: Event) => { value = (e.target as HTMLInputElement).value; } }),
    h("p", { class: "muted" }, "Typed by you, used once, never stored."),
    h("div", { class: "row" }, [
      h("button", { type: "submit", class: "primary", "data-testid": "need-submit" }, "Continue"),
      h("button", { type: "button", onclick: () => n.answer({}) }, "Cancel"),
    ]),
  ]);
}

function runView() {
  const tool = s.tool;
  const run: Run | undefined = s.result?.run;
  const status = run?.status ?? (s.runError ? "error" : "running");
  const blockedCount = s.result ? Math.max(s.result.blocked, s.blocked.length) : s.blocked.length;
  return h("section", { class: "card", "data-testid": "run-view" }, [
    h("div", { class: "row" }, [
      h("h2", {}, tool?.title ?? "Run"),
      h("span", { class: "status", "data-testid": "run-status", "data-status": status }, status.replaceAll("_", " ")),
      s.running ? h("button", { onclick: () => abort?.abort() }, "Stop") : h("button", { onclick: () => { Object.assign(s, { result: null, runError: null, tool: null }); render(); } }, "Done"),
    ]),
    needView(),
    h("ol", { class: "timeline", "data-testid": "timeline" }, (tool?.steps ?? []).map((st) => {
      const t = s.traces.get(st.id);
      return h("li", { "data-step": st.id, "data-status": t?.status ?? "pending" }, [
        h("span", { class: "dot" }), h("span", {}, [st.intent, t?.error ? h("span", { class: "why" }, t.error) : null]),
      ]);
    })),
    h("p", { "data-testid": "blocked" }, [h("b", { "data-testid": "blocked-count" }, String(blockedCount)), ` request${blockedCount === 1 ? "" : "s"} blocked by the network guard`]),
    s.blocked.length ? h("ul", { class: "muted" }, s.blocked.map((b) => h("li", {}, `${b.method} ${b.url}`))) : null,
    s.runError ? h("p", { class: "err" }, s.runError) : null,
    run && Object.keys(run.outputs).length
      ? h("dl", { "data-testid": "outputs" }, Object.entries(run.outputs).flatMap(([k, v]) => [h("dt", {}, k), h("dd", { "data-output": k }, v)]))
      : null,
    s.result ? h("p", { class: "muted", "data-testid": "report" }, s.result.reportId ? `Reported to MCPify (run ${s.result.reportId}).` : "Not reported (API not reachable).") : null,
  ]);
}

function chatView() {
  let text = "";
  const disabled = s.chatDisabled ?? (s.source.tools.length ? null : "No tools for this site.");
  return h("section", { class: "card" }, [
    h("div", { class: "chatlog" }, s.chatLog.map((m) => h("div", { class: `msg ${m.who}` }, m.text))),
    disabled ? h("p", { class: "muted", "data-testid": "chat-disabled" }, disabled) : null,
    h("form", { onsubmit: (e: Event) => { e.preventDefault(); if (text.trim()) void sendChat(text.trim()); } }, [
      h("textarea", { rows: 3, placeholder: "Describe the task, for example: check the status of SSP-2026-000123", disabled: !!disabled || s.running, oninput: (e: Event) => { text = (e.target as HTMLTextAreaElement).value; } }),
      h("button", { type: "submit", class: "primary", disabled: !!disabled || s.running }, "Send"),
    ]),
  ]);
}

function settingsView() {
  let base = s.apiBase;
  return h("section", { class: "card" }, [
    h("label", { class: "field" }, ["MCPify API", h("input", { value: base, "data-testid": "api-base", oninput: (e: Event) => { base = (e.target as HTMLInputElement).value; } })]),
    h("button", {
      class: "primary", onclick: async () => {
        s.apiBase = base.replace(/\/+$/, "");
        await chrome.storage.local.set({ apiBase: s.apiBase });
        s.origin = null;
        await refreshTab();
      },
    }, "Save"),
    s.origin && !s.policy.isDemo ? h("p", { class: "muted" }, `${s.origin} is not a demo portal: runs here are always dry runs with the network guard on.`) : null,
  ]);
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const stored = await chrome.storage.local.get("apiBase");
  if (typeof stored.apiBase === "string" && stored.apiBase) s.apiBase = stored.apiBase;
  render();
  await refreshTab();
  if (!fixedTabId) {
    chrome.tabs.onActivated.addListener(() => void refreshTab());
    chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") void refreshTab(); });
  }
}
void boot();
