import type { Condition } from "@mcpify/contracts";
import type { Driver } from "./types.js";

export interface CheckResult {
  ok: boolean;
  detail?: string;
}

export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Evaluate one condition once. `extract` writes into outputs. */
export async function evalCondition(
  c: Condition,
  driver: Driver,
  inputs: Record<string, unknown>,
  outputs: Record<string, string>,
): Promise<CheckResult> {
  try {
    switch (c.kind) {
      case "visible":
        return (await driver.isVisible(c.locators)) ? { ok: true } : { ok: false, detail: "element not visible" };
      case "hidden":
        return (await driver.isVisible(c.locators)) ? { ok: false, detail: "element still visible" } : { ok: true };
      case "textPresent": {
        const ok = norm(await driver.pageText()).includes(norm(c.text));
        return ok ? { ok } : { ok, detail: `text "${c.text}" not on page` };
      }
      case "textAbsent": {
        const ok = !norm(await driver.pageText()).includes(norm(c.text));
        return ok ? { ok } : { ok, detail: `text "${c.text}" still on page` };
      }
      case "urlMatches": {
        const url = await driver.url();
        const ok = new RegExp(c.pattern).test(url);
        return ok ? { ok } : { ok, detail: `url ${url} does not match /${c.pattern}/` };
      }
      case "valueEquals": {
        const r = await driver.resolve(c.locators);
        if (!r) return { ok: false, detail: "field not found" };
        const actual = await driver.value(r.handle);
        const expected = formatInput(inputs[c.param]);
        const ok = norm(actual) === norm(expected);
        return ok ? { ok } : { ok, detail: `field holds "${actual}", expected "${expected}"` };
      }
      case "noErrorNear": {
        const r = await driver.resolve(c.locators);
        if (!r) return { ok: true, detail: "field gone (page changed)" };
        return (await driver.hasErrorNear(r.handle)) ? { ok: false, detail: "validation error next to field" } : { ok: true };
      }
      case "extract": {
        const r = await driver.resolve(c.locators);
        if (!r) return { ok: false, detail: `nothing to extract for ${c.as}` };
        const text = (await driver.text(r.handle)).trim();
        const value = c.pattern ? (text.match(new RegExp(c.pattern))?.[0] ?? "") : text;
        if (!value) return { ok: false, detail: `"${text}" does not contain ${c.as}` };
        outputs[c.as] = value;
        return { ok: true, detail: `${c.as} = ${value}` };
      }
    }
  } catch (e) {
    return { ok: false, detail: `check error: ${(e as Error).message.split("\n")[0]}` };
  }
}

export function formatInput(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  return v === undefined || v === null ? "" : String(v);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const POLL_MS = 150;

/** Poll all conditions until they all pass or the timeout expires. */
export async function evalAllUntil(
  conds: Condition[],
  driver: Driver,
  inputs: Record<string, unknown>,
  outputs: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; results: CheckResult[] }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const results: CheckResult[] = [];
    for (const c of conds) results.push(await evalCondition(c, driver, inputs, outputs));
    const ok = results.every((r) => r.ok);
    if (ok || Date.now() >= deadline || signal?.aborted) return { ok, results };
    await sleep(POLL_MS);
  }
}

/** Retry locator resolution until the timeout. */
export async function resolveUntil(driver: Driver, step: { locators: Parameters<Driver["resolve"]>[0] }, timeoutMs: number, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await driver.resolve(step.locators).catch(() => null);
    if (r || Date.now() >= deadline || signal?.aborted) return r;
    await sleep(POLL_MS);
  }
}
