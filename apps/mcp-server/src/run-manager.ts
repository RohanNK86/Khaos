import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { redactInputs, type Need, type Receipt, type Run, type RunStatus, type StepTrace, type Tool } from "@mcpify/contracts";
import { runTool, type NeedAnswer } from "@mcpify/engine";
import { createPlaywrightDriver } from "@mcpify/engine/playwright";
import { FsBlobStore, LocalEd25519Signer, issueReceipt, verifyReceipt } from "@mcpify/storage";
import type { Entry } from "./registry.js";
import { DATA, p } from "./paths.js";

const TERMINAL: RunStatus[] = ["succeeded", "failed", "stopped", "dry_run_complete", "repair_pending"];
const IDLE_MS = 10 * 60 * 1000;
const MAX_WAIT_MS = Number(process.env.MCPIFY_MAX_WAIT_MS ?? 100_000);

interface Live {
  run: Run;
  entry: Entry;
  pending?: (a: NeedAnswer) => void;
  waiters: (() => void)[];
  abort: AbortController;
  ctx?: BrowserContext;
  lastActivity: number;
}

export interface ManagerOptions {
  headless?: boolean;
  /** Highlight + pause on each action so a live audience can follow. */
  showActions?: boolean;
  /** Called after any change (live view). */
  onChange?: (run: Run) => void;
}

/** Owns live runs: one browser context per run; pauses map to MCP tool-call returns. */
export class RunManager {
  private runs = new Map<string, Live>();
  private receipts = new Map<string, Receipt>();
  private browser?: Promise<Browser>;
  private blobs = new FsBlobStore(join(DATA, "blobs"));
  private signer = new LocalEd25519Signer(join(DATA, "keys"));

  constructor(private opts: ManagerOptions = {}) {
    setInterval(() => this.reapIdle(), 30_000).unref();
  }

  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: this.opts.headless ?? false, args: ["--window-size=1100,900"] });
    return this.browser;
  }

  /** Start a run and resolve at its first pause or end. */
  async start(entry: Entry, inputs: Record<string, unknown>, dryRun: boolean): Promise<Run> {
    const runId = crypto.randomUUID();
    const tool = entry.tool;
    const live: Live = {
      entry, waiters: [], abort: new AbortController(), lastActivity: Date.now(),
      run: {
        id: runId, toolId: tool.id, toolVersion: tool.version, mode: "owner", dryRun, status: "running",
        inputsRedacted: redactInputs(tool, inputs), outputs: {}, trace: [], startedAt: new Date().toISOString(),
      },
    };
    this.runs.set(runId, live);
    this.changed(live);

    const browser = await this.getBrowser();
    live.ctx = await browser.newContext({ viewport: { width: 1080, height: 820 } });
    const page = await live.ctx.newPage();
    const driver = createPlaywrightDriver(page, { showActions: this.opts.showActions ?? !(this.opts.headless ?? false) });

    void runTool(tool, inputs, driver, {
      onNeed: (need) => this.pause(live, need),
      onStep: (t) => this.step(live, t),
      saveBlob: (content, mime) => this.blobs.put(content, mime),
      loadFile: (ref) => loadFile(ref),
    }, { dryRun, mode: "owner", runId, signal: live.abort.signal })
      .then(async (final) => {
        live.run = { ...final, trace: final.trace };
        if (final.status === "succeeded" && final.trace.some((t) => t.status === "passed" && tool.steps.find((s) => s.id === t.stepId)?.risk === "commit")) {
          const receipt = await issueReceipt(this.signer, tool, final, inputs, entry.site.origin);
          this.receipts.set(receipt.id, receipt);
          live.run.receiptId = receipt.id;
          await saveJson(join(DATA, "receipts", `${receipt.id}.json`), receipt);
        }
      })
      .catch((e: Error) => {
        live.run = { ...live.run, status: "failed", endedAt: new Date().toISOString() };
        live.run.trace.push({ stepId: "engine", status: "failed", preResults: [], postResults: [], startedAt: new Date().toISOString(), durationMs: 0, error: e.message });
      })
      .finally(() => {
        this.changed(live);
        // keep the final page on screen for a moment, then free the browser context
        setTimeout(() => void live.ctx?.close().catch(() => undefined), 15_000).unref();
      });

    return this.waitForPause(live);
  }

  /** Answer the current need and resolve at the next pause or end. */
  async continue(runId: string, answer: NeedAnswer): Promise<Run> {
    const live = this.mustGet(runId);
    if (!live.pending) return live.run;
    const resolve = live.pending;
    live.pending = undefined;
    live.run = { ...live.run, status: "running", need: undefined };
    live.lastActivity = Date.now();
    this.changed(live);
    resolve(answer);
    return this.waitForPause(live);
  }

  async cancel(runId: string): Promise<Run> {
    const live = this.mustGet(runId);
    live.abort.abort();
    if (live.pending) {
      const r = live.pending;
      live.pending = undefined;
      live.run = { ...live.run, status: "running", need: undefined };
      r({ approve: false });
    }
    return this.waitForPause(live);
  }

  get(runId: string): Run | undefined {
    return this.runs.get(runId)?.run;
  }

  list(): Run[] {
    return [...this.runs.values()].map((l) => l.run).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  toolOf(runId: string): Tool | undefined {
    return this.runs.get(runId)?.entry.tool;
  }

  getReceipt(id: string): Receipt | undefined {
    return this.receipts.get(id);
  }

  verify(receipt: Receipt): Promise<boolean> {
    return verifyReceipt(this.signer, receipt);
  }

  async close() {
    for (const l of this.runs.values()) l.abort.abort();
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }

  // ── internals ──────────────────────────────────────────────────────────────
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
    live.run = { ...live.run, trace: [...trace, t] };
    live.lastActivity = Date.now();
    this.changed(live);
  }

  private changed(live: Live) {
    this.opts.onChange?.(live.run);
    const ws = live.waiters.splice(0);
    for (const w of ws) w();
  }

  private isPaused(r: Run) {
    return TERMINAL.includes(r.status) || r.status.startsWith("awaiting");
  }

  private async waitForPause(live: Live): Promise<Run> {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (!this.isPaused(live.run) && Date.now() < deadline) {
      await new Promise<void>((res) => {
        live.waiters.push(res);
        setTimeout(res, 1000).unref();
      });
    }
    return live.run;
  }

  private mustGet(runId: string): Live {
    const live = this.runs.get(runId);
    if (!live) throw new Error(`unknown run_id ${runId}`);
    return live;
  }

  private reapIdle() {
    for (const [id, l] of this.runs) {
      if (l.pending && Date.now() - l.lastActivity > IDLE_MS) void this.cancel(id);
    }
  }
}

/** Upload params are plain file names from fixtures/files (the demo "file store"). */
async function loadFile(ref: string) {
  const name = basename(ref);
  const bytes = await readFile(p("fixtures/files", name));
  const mime = /\.pdf$/i.test(name) ? "application/pdf" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "application/octet-stream";
  return { name, mime, bytes };
}

async function saveJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}
