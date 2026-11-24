import {
  buildPreview, redactInputs, sensitiveParams, stepParam,
  type Run, type StepContract, type StepTrace, type Tool,
} from "@mcpify/contracts";
import { evalAllUntil, formatInput, resolveUntil, type CheckResult } from "./conditions.js";
import type { Driver, RunHooks, RunOptions } from "./types.js";

const DEFAULT_TIMEOUT_MS = 8000;
const NEEDS_ELEMENT = new Set(["fill", "select", "check", "click", "upload", "userInput"]);

class StepFailure extends Error {}
class StopRun extends Error {}

/**
 * Run a tool: for every step CHECK pre → (risk gate) → EXECUTE → VERIFY post.
 * Never calls a model. Pauses through hooks.onNeed for commit (confirmation) and auth (user input).
 */
export async function runTool(
  tool: Tool,
  inputs: Record<string, unknown>,
  driver: Driver,
  hooks: RunHooks,
  opts: RunOptions,
): Promise<Run> {
  const run: Run = {
    id: opts.runId ?? globalThis.crypto.randomUUID(),
    toolId: tool.id,
    toolVersion: tool.version,
    mode: opts.mode,
    dryRun: opts.dryRun,
    status: "running",
    inputsRedacted: redactInputs(tool, inputs),
    outputs: {},
    trace: [],
    startedAt: new Date().toISOString(),
  };
  const committed = new Set(opts.committedStepIds ?? []);
  const sensitive = sensitiveParams(tool);
  const finish = (status: Run["status"]) => {
    run.status = status;
    run.endedAt = new Date().toISOString();
    return run;
  };

  for (let i = opts.startIndex ?? 0; i < tool.steps.length; i++) {
    const step = tool.steps[i]!;
    if (opts.signal?.aborted) return finish("stopped");
    const timeout = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const t0 = Date.now();
    const trace: StepTrace = { stepId: step.id, status: "passed", preResults: [], postResults: [], startedAt: new Date(t0).toISOString(), durationMs: 0 };
    const push = (status: StepTrace["status"]) => {
      trace.status = status;
      trace.durationMs = Date.now() - t0;
      run.trace.push(trace);
      hooks.onStep?.(trace);
    };

    if (step.risk === "commit" && committed.has(step.id)) {
      push("skipped"); // idempotency: a commit never runs twice in one run
      continue;
    }

    try {
      // 1. CHECK
      const pre = await evalAllUntil(step.pre, driver, inputs, run.outputs, timeout, opts.signal);
      trace.preResults = pre.results;
      if (!pre.ok) throw new StepFailure(`precondition failed: ${failed(pre.results)}`);

      // 2. Risk gates
      let userValue: string | undefined;
      if (step.risk === "commit") {
        if (opts.dryRun) {
          push("blocked_dry_run");
          return finish("dry_run_complete");
        }
        hooks.onStep?.({ ...trace, status: "awaiting" });
        const ans = await hooks.onNeed({ kind: "confirmation", stepId: step.id, preview: buildPreview(tool, inputs) });
        if (!ans.approve) throw new StopRun("the user did not approve");
      }
      if (step.action.type === "userInput") {
        hooks.onStep?.({ ...trace, status: "awaiting" });
        const ans = await hooks.onNeed({
          kind: "user_input", stepId: step.id, param: step.action.param, prompt: step.action.prompt,
          sensitive: step.sensitive ?? step.risk === "auth",
        });
        if (!ans.value) throw new StopRun("no value was given");
        userValue = ans.value;
      }
      if (opts.signal?.aborted) return finish("stopped");

      // 3. EXECUTE
      await execute(step, tool, inputs, userValue, driver, hooks, trace, timeout, opts.signal);
      if (step.risk === "commit") committed.add(step.id);

      // 4. VERIFY (user-provided values are checked by the page itself, never stored)
      const postInputs = userValue !== undefined ? { ...inputs, [stepParam(step)!]: userValue } : inputs;
      const post = await evalAllUntil(step.post, driver, postInputs, run.outputs, timeout, opts.signal);
      trace.postResults = post.results;
      if (!post.ok) throw new StepFailure(`postcondition failed: ${failed(post.results)}`);
      push("passed");
    } catch (e) {
      if (e instanceof StopRun) {
        trace.error = e.message;
        push("skipped");
        return finish("stopped");
      }
      trace.error = await describeFailure(e as Error, driver, sensitive, inputs);
      trace.evidenceBlobId = await saveEvidence(driver, hooks);
      push("failed");
      run.failedStepId = step.id;
      return finish("failed");
    }
  }
  return finish("succeeded");
}

async function execute(
  step: StepContract, tool: Tool, inputs: Record<string, unknown>, userValue: string | undefined,
  driver: Driver, hooks: RunHooks, trace: StepTrace, timeout: number, signal?: AbortSignal,
) {
  const a = step.action;
  if (a.type === "navigate") {
    await driver.goto(new URL(a.url, tool.startUrl).toString());
    await driver.waitForSettled(timeout);
    return;
  }
  if (a.type === "waitFor") {
    const r = await evalAllUntil([a.condition], driver, inputs, {}, timeout, signal);
    if (!r.ok) throw new StepFailure(`waitFor failed: ${failed(r.results)}`);
    return;
  }
  if (!NEEDS_ELEMENT.has(a.type)) return; // extract: work happens in post
  const found = await resolveUntil(driver, step, timeout, signal);
  if (!found) throw new StepFailure(`no locator matched exactly one visible element (tried ${step.locators.map((l) => l.kind).join(", ")})`);
  trace.usedLocator = found.used;
  const el = found.handle;
  switch (a.type) {
    case "fill":
      return driver.fill(el, formatInput(requireInput(inputs, a.param)));
    case "select":
      return driver.select(el, formatInput(requireInput(inputs, a.param)));
    case "check":
      return driver.check(el, requireInput(inputs, a.param) === true || requireInput(inputs, a.param) === "true");
    case "upload": {
      if (!hooks.loadFile) throw new StepFailure("this runner cannot load files for upload");
      return driver.upload(el, await hooks.loadFile(String(requireInput(inputs, a.param))));
    }
    case "userInput":
      return driver.fill(el, userValue ?? "");
    case "click":
      await driver.click(el);
      await driver.waitForSettled(timeout);
      return;
  }
}

function requireInput(inputs: Record<string, unknown>, param: string): unknown {
  const v = inputs[param];
  if (v === undefined || v === null || v === "") throw new StepFailure(`missing input "${param}"`);
  return v;
}

const failed = (rs: CheckResult[]) => rs.filter((r) => !r.ok).map((r) => r.detail ?? "check failed").join("; ");

async function describeFailure(e: Error, driver: Driver, sensitive: Set<string>, inputs: Record<string, unknown>) {
  let msg = e instanceof StepFailure ? e.message : `driver error: ${e.message.split("\n")[0]}`;
  const errs = await driver.errors?.().catch(() => []);
  if (errs?.length) msg += ` | the page says: ${errs.join("; ")}`;
  for (const p of sensitive) {
    const v = inputs[p];
    if (typeof v === "string" && v) msg = msg.replaceAll(v, "•••");
  }
  return msg;
}

async function saveEvidence(driver: Driver, hooks: RunHooks): Promise<string | undefined> {
  if (!hooks.saveBlob) return undefined;
  try {
    return await hooks.saveBlob(await driver.snapshot(), "text/html");
  } catch {
    return undefined;
  }
}
