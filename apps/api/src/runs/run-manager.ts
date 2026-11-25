import { chromium, type Browser, type BrowserContext } from "playwright";
import { MASK, redactInputs, sensitiveParams, type Need, type Run, type RunMode, type RunStatus, type Site, type StepTrace, type Tool } from "@mcpify/contracts";
import { runTool, type Driver, type NeedAnswer, type RunHooks, type RunOptions } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";
import { installNetworkGuard, type BlockedRequest } from "@mcpify/engine/network-guard";
import type { BlobStore, Signer } from "@mcpify/storage";
import { HttpError, notFound } from "../http.js";
import { executedCommit, issueForRun } from "../receipts-service.js";
import type { Store } from "../store.js";
import { loadFile } from "./files.js";
import { evidenceOf, onStepFailed, type RepairContext } from "./repair-hook.js";

const TERMINAL: RunStatus[] = ["succeeded", "failed", "stopped", "dry_run_complete", "repair_pending"];
const IDLE_MS = 10 * 60 * 1000;
const MAX_WAIT_MS = Number(process.env.MCPIFY_MAX_WAIT_MS ?? 100_000);

export const isTerminal = (s: RunStatus) => TERMINAL.includes(s);
const isPaused = (r: Run) => isTerminal(r.status) || r.status.startsWith("awaiting");

interface Live {
  run: Run;
  tool: Tool;
  inputs: Record<string, unknown>;
  /** Values that must never be stored or returned (sensitive inputs, OTPs). */
  secrets: Set<string>;
  pending?: (a: NeedAnswer) => void;
  waiters: (() => void)[];
  abort: AbortController;
  ctx?: BrowserContext;
  lastActivity: number;
  blocked: BlockedRequest[];
  saving: Promise<void>;
  /** Kept so a repaired tool can continue in the same page. */
  exec?: { driver: Driver; hooks: RunHooks; opts: RunOptions };
}

export interface RunManagerDeps {
  store: Store;
  blobs: BlobStore;
  signer: Signer;
  headless?: boolean;
  /** Highlight + pause on each action so a live audience can follow (default: when headed). */
  showActions?: boolean;
}

export interface StartRequest {
  tool: Tool;
  site: Site;
  inputs: Record<string, unknown>;
  mode: RunMode;
  dryRun: boolean;
}

/** Owns live server-side runs: one browser context per run; each pause returns to the HTTP caller. */
export class RunManager {
  private runs = new Map<string, Live>();
  private browser?: Promise<Browser>;
  private reaper = setInterval(() => this.reapIdle(), 30_000);

  constructor(private deps: RunManagerDeps) {
    this.reaper.unref();
  }

  /** Start a run and resolve at its first pause or end. */
  async start(req: StartRequest): Promise<Run> {
    const { tool, site, inputs } = req;
    const dryRun = req.dryRun || site.mode === "user_only";
    const runId = crypto.randomUUID();
    const live: Live = {
      tool, inputs, secrets: sensitiveValues(tool, inputs), waiters: [], abort: new AbortController(),
      lastActivity: Date.now(), blocked: [], saving: Promise.resolve(),
      run: {
        id: runId, toolId: tool.id, toolVersion: tool.version, mode: req.mode, dryRun, status: "running",
        inputsRedacted: redactInputs(tool, inputs), outputs: {}, trace: [], startedAt: new Date().toISOString(),
      },
    };
    this.runs.set(runId, live);
    this.changed(live);
    await this.deps.store.audit({ siteId: tool.siteId, toolId: tool.id, runId, actor: "agent", action: "run.started", detail: dryRun ? "dry run" : undefined });

    try {
      const page = await this.openPage(live, site, dryRun);
      const driver = createPlaywrightDriver(page, { showActions: this.deps.showActions ?? !(this.deps.headless ?? false) });
      const hooks: RunHooks = {
        onNeed: (need) => this.pause(live, need),
        onStep: (t) => this.step(live, t),
        saveBlob: (content, mime) => this.deps.blobs.put(content, mime),
        loadFile,
      };
      const opts: RunOptions = { dryRun, mode: req.mode, runId, signal: live.abort.signal };
      live.exec = { driver, hooks, opts };
      void runTool(tool, inputs, driver, hooks, opts)
        .then((final) => this.finish(live, final))
        .catch((e: Error) => this.crash(live, e));
    } catch (e) {
      await this.crash(live, e as Error);
    }
    return this.waitForPause(live);
  }

  /** Answer the current need and resolve at the next pause or end. */
  async continue(runId: string, answer: NeedAnswer): Promise<Run> {
    const live = this.runs.get(runId);
    if (!live) return this.stored(runId);
    if (!live.pending) return this.waitForPause(live);
    const need = live.run.need;
    if (need?.kind === "confirmation" && typeof answer.approve !== "boolean") throw new HttpError(400, "this run is waiting for a confirmation: pass approve=true or approve=false");
    if (need?.kind === "user_input" && !answer.value) throw new HttpError(400, `this run is waiting for ${need.param}: pass value`);
    if (need?.kind === "user_input" && answer.value && answer.value.length >= 3) live.secrets.add(answer.value);
    const resolve = live.pending;
    live.pending = undefined;
    live.run = { ...live.run, status: "running", need: undefined };
    live.lastActivity = Date.now();
    this.changed(live);
    resolve(answer);
    return this.waitForPause(live);
  }

  async cancel(runId: string): Promise<Run> {
    const live = this.runs.get(runId);
    if (!live) return this.stored(runId);
    if (isTerminal(live.run.status)) return this.view(live);
    live.abort.abort();
    if (live.pending) {
      const r = live.pending;
      live.pending = undefined;
      live.run = { ...live.run, status: "running", need: undefined };
      r({ approve: false });
    }
    return this.waitForPause(live);
  }

  /** The live (redacted) run, if this process is running it. */
  get(runId: string): Run | undefined {
    const live = this.runs.get(runId);
    return live && this.view(live);
  }

  liveRuns(): Run[] {
    return [...this.runs.values()].map((l) => this.view(l));
  }

  blockedOf(runId: string): BlockedRequest[] {
    return this.runs.get(runId)?.blocked ?? [];
  }

  /** Inputs of a live run (for receipts issued later). */
  inputsOf(runId: string): Record<string, unknown> | undefined {
    return this.runs.get(runId)?.inputs;
  }

  async close(): Promise<void> {
    clearInterval(this.reaper);
    for (const l of this.runs.values()) l.abort.abort();
    await Promise.all([...this.runs.values()].map((l) => l.saving));
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: this.deps.headless ?? false, args: ["--window-size=1100,900"] });
    return this.browser;
  }

  private async openPage(live: Live, site: Site, dryRun: boolean) {
    live.ctx = await (await this.getBrowser()).newContext({ viewport: { width: 1080, height: 820 } });
    // third-party sites: block every sending request at the network level too
    if (dryRun && site.mode === "user_only") {
      live.blocked = await installNetworkGuard(live.ctx, (b) => {
        console.log(`[dry-run] blocked ${b.method} ${b.url}`);
        this.changed(live);
      });
    }
    return live.ctx.newPage();
  }

  private async finish(live: Live, final: Run): Promise<void> {
    let run: Run = { ...final };
    if (run.status === "failed") run = await onStepFailed(this.scrub(live, run), live.tool, evidenceOf(run), await this.repairContext(live, run));
    if (run.status === "succeeded" && executedCommit(run, live.tool)) {
      const receipt = await issueForRun(this.deps.store, this.deps.signer, this.scrub(live, run), live.tool, live.inputs).catch((e: Error) => {
        console.error(`[runs] receipt for ${run.id} failed: ${e.message}`);
        return undefined;
      });
      if (receipt) run.receiptId = receipt.id;
    }
    live.run = run;
    await this.deps.store.audit({ siteId: live.tool.siteId, toolId: live.tool.id, runId: run.id, actor: "system", action: "run.finished", detail: run.status });
    this.done(live);
  }

  /** Lets the repair handler continue this run (once) with a patched tool in the same page. */
  private async repairContext(live: Live, failed: Run): Promise<RepairContext | undefined> {
    if (!live.exec || live.abort.signal.aborted) return undefined;
    const exec = live.exec;
    live.exec = undefined; // one repair per run
    return {
      inputs: live.inputs,
      browser: await this.getBrowser(),
      loadFile,
      retry: async (patched, startIndex) => {
        const committedStepIds = failed.trace
          .filter((t) => t.status === "passed" && live.tool.steps.find((s) => s.id === t.stepId)?.risk === "commit")
          .map((t) => t.stepId);
        live.tool = patched;
        live.run = { ...live.run, toolVersion: patched.version };
        this.changed(live);
        const again = await runTool(patched, live.inputs, exec.driver, exec.hooks, { ...exec.opts, startIndex, committedStepIds });
        return { ...again, toolVersion: patched.version, startedAt: failed.startedAt, trace: [...failed.trace, ...again.trace] };
      },
    };
  }

  private async crash(live: Live, e: Error): Promise<void> {
    console.error(`[runs] ${live.run.id} crashed: ${e.message}`);
    const now = new Date().toISOString();
    live.run = {
      ...live.run, status: "failed", need: undefined, endedAt: now,
      trace: [...live.run.trace, { stepId: "engine", status: "failed", preResults: [], postResults: [], startedAt: now, durationMs: 0, error: e.message.split("\n")[0] }],
    };
    await this.deps.store.audit({ siteId: live.tool.siteId, toolId: live.tool.id, runId: live.run.id, actor: "system", action: "run.finished", detail: "failed (engine error)" }).catch(() => undefined);
    this.done(live);
  }

  private done(live: Live) {
    this.changed(live);
    // keep the final page on screen for a moment when headed, then free the browser context
    const delay = this.deps.headless ? 0 : 15_000;
    setTimeout(() => void live.ctx?.close().catch(() => undefined), delay).unref();
  }

  private pause(live: Live, need: Need): Promise<NeedAnswer> {
    return new Promise((resolve) => {
      live.pending = resolve;
      live.run = { ...live.run, status: need.kind === "confirmation" ? "awaiting_confirmation" : "awaiting_user_input", need };
      live.lastActivity = Date.now();
      this.changed(live);
    });
  }

  private step(live: Live, t: StepTrace) {
    const trace = live.run.trace.filter((x) => !(x.stepId === t.stepId && x.status === "awaiting"));
    live.run = { ...live.run, trace: [...trace, { ...t }] };
    live.lastActivity = Date.now();
    this.changed(live);
  }

  /** Persist (redacted, serialised per run) and wake waiters. */
  private changed(live: Live) {
    const snapshot = this.view(live);
    live.saving = live.saving
      .then(() => this.deps.store.saveRun(snapshot))
      .catch((e: Error) => console.error(`[runs] could not save ${snapshot.id}: ${e.message}`));
    for (const w of live.waiters.splice(0)) w();
  }

  private view(live: Live): Run {
    return this.scrub(live, live.run);
  }

  /** Replace every secret value anywhere in the run with the mask (OTPs can appear in check details). */
  private scrub(live: Live, run: Run): Run {
    const secrets = [...live.secrets];
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") return secrets.reduce((s, x) => s.replaceAll(x, MASK), v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    return walk(run) as Run;
  }

  private async waitForPause(live: Live): Promise<Run> {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (!isPaused(live.run) && Date.now() < deadline) {
      await new Promise<void>((res) => {
        live.waiters.push(res);
        setTimeout(res, 1000).unref();
      });
    }
    await live.saving;
    return this.view(live);
  }

  private async stored(runId: string): Promise<Run> {
    const run = await this.deps.store.getRun(runId);
    if (!run) throw notFound(`run ${runId}`);
    if (!isTerminal(run.status)) throw new HttpError(409, `run ${runId} is no longer live (the server restarted); start a new run`);
    return run;
  }

  private reapIdle() {
    for (const [id, l] of this.runs) {
      if (l.pending && Date.now() - l.lastActivity > IDLE_MS) void this.cancel(id).catch(() => undefined);
    }
  }
}

function sensitiveValues(tool: Tool, inputs: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const k of sensitiveParams(tool)) {
    const v = inputs[k];
    if (v !== undefined && v !== null && String(v).length >= 3) out.add(String(v));
  }
  return out;
}
