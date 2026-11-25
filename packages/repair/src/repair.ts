import { chromium, type Browser } from "playwright";
import type { Locator, RepairProposal, StepContract, Tool } from "@mcpify/contracts";
import { openEvidence, type Candidate, type EvidencePage } from "./evidence.js";
import { llmPick } from "./llm.js";
import { pickConfident, rank, signatureOf, synthesizeLocators, withLocators, type OldSignature } from "./match.js";
import { applyOptionAliases, encodeAliases, mapOptions } from "./options.js";
import { retargetTool, runSandbox, type SandboxOptions } from "./sandbox.js";

export type RepairDraft = Omit<RepairProposal, "id" | "createdAt">;
type Method = RepairProposal["method"];

export interface RepairArgs {
  tool: Tool;
  failedStepId: string;
  /** Full HTML of the page when the step failed (the engine's evidence snapshot). */
  evidenceHtml: string;
  /** Human-readable failed checks (see failedChecksFromRun). */
  failedChecks: string[];
  /** Blob id of the evidence snapshot, copied into the proposal. */
  evidenceBlobId?: string;
  /** Run the sandbox against this origin instead of the tool's own (test ports, staging). */
  portalUrl?: string;
  /** Inputs etc. for the sandbox replay; without it the sandbox is not run and nothing is auto-applied. */
  sandbox?: SandboxOptions;
  /** Reuse a Playwright browser (else one headless Chromium is launched and closed). */
  browser?: Browser;
}

interface Match {
  c: Candidate;
  method: Method;
  confidence: number;
  locators: Locator[];
  note: string;
}

const AUTO_MIN_CONFIDENCE = 0.8;
const TIER1_CONFIDENCE = 0.9;
const NOT_ON_PAGE = 0.5;
const round = (n: number) => Math.round(n * 100) / 100;
const describeC = (c: Candidate) => `<${c.tag}${c.id ? ` id=${c.id}` : ""}> "${c.labelRaw || c.text}"`;

/** Tier 1: an existing locator still resolves uniquely → keep the ones that agree, best first. */
async function tier1(ev: EvidencePage, step: StepContract): Promise<Match | null> {
  const hits = await Promise.all(step.locators.map((l) => ev.resolve([l])));
  const target = hits.find((h) => h >= 0);
  const c = ev.candidates.find((x) => x.i === target);
  if (target === undefined || !c) return null;
  const agree = step.locators.filter((_, k) => hits[k] === target);
  const unknown = step.locators.filter((_, k) => hits[k] === -1);
  return {
    c, method: "locator_fallback", confidence: TIER1_CONFIDENCE, locators: [...agree, ...unknown].slice(0, 5),
    note: `existing locator ${agree.map((l) => l.kind).join("/")} still resolves to ${describeC(c)}`,
  };
}

/** Form of the element the closest earlier step acts on (buttons should stay in that form). */
async function previousForm(ev: EvidencePage, tool: Tool, idx: number): Promise<string | undefined> {
  for (let k = idx - 1; k >= 0; k--) {
    const s = tool.steps[k]!;
    if (!s.locators.length) continue;
    const i = await ev.resolve(s.locators);
    if (i >= 0) return ev.candidates.find((c) => c.i === i)?.form;
  }
  return undefined;
}

/** Tiers 2 and 3. Returns the match or the best heuristic score seen (to tell "ambiguous" from "gone"). */
async function rematch(ev: EvidencePage, tool: Tool, step: StepContract, sig: OldSignature): Promise<Match | { best: number }> {
  const ranked = rank(sig, ev.candidates, await previousForm(ev, tool, tool.steps.indexOf(step)));
  const sure = pickConfident(ranked);
  if (sure) {
    const locators = await synthesizeLocators(ev, sure.c, step.locators);
    if (locators.length) {
      const runnerUp = ranked[1] ? `, runner-up ${round(ranked[1].score)}` : "";
      return { c: sure.c, method: "heuristic", confidence: round(sure.score), locators, note: `heuristic re-match ${describeC(sure.c)} score ${round(sure.score)}${runnerUp}` };
    }
  }
  const llm = await llmPick(step, sig, ranked.map((r) => r.c));
  if (llm) {
    const locators = await synthesizeLocators(ev, llm.c, step.locators);
    // LLM picks never reach the auto-apply threshold on their own: the owner reviews them.
    const confidence = ranked[0]?.c.i === llm.c.i ? 0.75 : 0.6;
    if (locators.length) return { c: llm.c, method: "llm", confidence, locators, note: `LLM picked ${describeC(llm.c)}: ${llm.reason}` };
  }
  return { best: ranked[0]?.score ?? 0 };
}

/** Required inputs on the page that no tool step fills (other than the repaired element) → structural change. */
async function uncoveredRequired(ev: EvidencePage, tool: Tool, step: StepContract, matched?: Candidate): Promise<Candidate[]> {
  const covered = new Set<number>();
  for (const s of tool.steps) {
    if (s === step || !s.locators.length) continue;
    covered.add(await ev.resolve(s.locators));
  }
  return ev.candidates.filter((c) =>
    c.required && ["text", "select", "check", "file"].includes(c.kind) && !covered.has(c.i) && c.i !== matched?.i);
}

function draft(a: RepairArgs, step: StepContract, part: Pick<RepairDraft, "proposedStep" | "method" | "confidence" | "sandbox" | "status"> & { note: string }): RepairDraft {
  return {
    toolId: a.tool.id,
    fromVersion: a.tool.version,
    stepId: step.id,
    reason: `${a.failedChecks.join("; ") || "step failed"} → ${part.note}`,
    evidence: { domSnapshotBlobId: a.evidenceBlobId ?? "inline", failedChecks: a.failedChecks },
    proposedStep: part.proposedStep,
    method: part.method,
    confidence: part.confidence,
    sandbox: part.sandbox,
    reversible: step.risk === "read" || step.risk === "fill",
    status: part.status,
  };
}

const NOT_RUN = (why: string) => ({ passed: false, detail: `sandbox not run: ${why}` });

/**
 * Verified Selective Repair for ONE failed step (rohan.md R5). Only the failed step changes; other steps are frozen.
 * Tier 1 locator fallback → tier 2 heuristic re-match → tier 3 LLM (if available) → structural check → sandbox.
 */
export async function repairStep(a: RepairArgs): Promise<RepairDraft> {
  const step = a.tool.steps.find((s) => s.id === a.failedStepId);
  if (!step) throw new Error(`step ${a.failedStepId} is not in tool ${a.tool.name}`);
  const own = (a.browser ?? a.sandbox?.browser) ? undefined : await chromium.launch();
  const browser = (a.browser ?? a.sandbox?.browser ?? own)!;
  try {
    const ev = await openEvidence(browser, a.evidenceHtml);
    let found: Match | { best: number };
    let extra: Candidate[];
    try {
      found = (await tier1(ev, step)) ?? (await rematch(ev, a.tool, step, signatureOf(step)));
      extra = await uncoveredRequired(ev, a.tool, step, "c" in found ? found.c : undefined);
    } finally {
      await ev.close();
    }
    if (extra.length) {
      const names = extra.map((c) => `"${c.labelRaw || c.name || c.id}"`).join(", ");
      return draft(a, step, { proposedStep: step, method: "c" in found ? found.method : "heuristic", confidence: 0, sandbox: NOT_RUN("structural change"), status: "needs_rerecord", note: `structural change: new required field(s) ${names} not filled by any step; re-record the task` });
    }
    if (!("c" in found)) {
      const gone = found.best < NOT_ON_PAGE;
      return draft(a, step, {
        proposedStep: step, method: "heuristic", confidence: round(found.best), sandbox: NOT_RUN("no match"),
        status: gone ? "needs_rerecord" : "pending",
        note: gone ? "the step's element is no longer on this page (page split or moved); re-record the task"
          : `no confident match (best score ${round(found.best)}); owner must fix the step`,
      });
    }
    return await finishMatch(a, step, found, browser);
  } finally {
    await own?.close();
  }
}

/** Option mapping (selects), sandbox replay and the auto-apply rule for a found element. */
async function finishMatch(a: RepairArgs, step: StepContract, m: Match, browser: Browser): Promise<RepairDraft> {
  const proposedStep = withLocators(step, m.locators);
  let { method, confidence, note } = m;
  let inputs = a.sandbox?.inputs;
  const param = "param" in step.action ? step.action.param : "";
  const opt = mapOptions(a.tool, step, m.c, inputs?.[param]);
  if (opt === null) {
    return draft(a, step, { proposedStep, method, confidence: 0, sandbox: NOT_RUN("options changed"), status: "pending", note: `${note}; select options changed and could not be mapped` });
  }
  const aliased = opt !== "not_needed";
  if (aliased) {
    method = "heuristic";
    confidence = round(Math.min(confidence, opt.score));
    note = `${note}; options relabelled, the agent's values must be translated (StepContract has no option-mapping field, so this needs owner approval) ${encodeAliases(param, opt.aliases)}`;
    inputs = inputs && applyOptionAliases(inputs, { [param]: opt.aliases });
  }
  let sandbox = NOT_RUN("no sandbox inputs given");
  if (inputs) {
    const patched = { ...a.tool, steps: a.tool.steps.map((s) => (s.id === step.id ? proposedStep : s)) };
    const target = a.portalUrl ? retargetTool(patched, a.portalUrl) : patched;
    sandbox = await runSandbox(a.sandbox?.browser ?? browser, target, step.id, { ...a.sandbox!, inputs });
    if (aliased) sandbox.detail += " (with translated option values)";
  }
  const reversible = step.risk === "read" || step.risk === "fill";
  const auto = reversible && step.repair === "auto" && sandbox.passed && confidence >= AUTO_MIN_CONFIDENCE && !aliased;
  return draft(a, step, { proposedStep, method, confidence, sandbox, status: auto ? "auto_applied" : "pending", note });
}
