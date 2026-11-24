import type { PreviewItem, Site, StepContract, Tool } from "./schemas.js";

export const MASK = "•••";

/** MCP tool name: `${slug}__${name}`, max 64 chars, [a-zA-Z0-9_-]. */
export function mcpToolName(site: Pick<Site, "slug">, tool: Pick<Tool, "name">): string {
  const name = `${site.slug}__${tool.name}`;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error(`invalid MCP tool name: ${name}`);
  return name;
}

/** Canonical JSON: sorted object keys, no whitespace. Used for hashing and signing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

/** The input parameter a step consumes, if any. */
export function stepParam(step: StepContract): string | undefined {
  const a = step.action;
  return "param" in a ? a.param : undefined;
}

/** Names of params that are sensitive (from step flags or the input schema). */
export function sensitiveParams(tool: Tool): Set<string> {
  const out = new Set<string>();
  for (const s of tool.steps) {
    const p = stepParam(s);
    if (p && (s.sensitive || s.risk === "auth")) out.add(p);
  }
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { sensitive?: boolean }>;
  for (const [k, v] of Object.entries(props)) if (v?.sensitive) out.add(k);
  return out;
}

/** Stringify inputs and replace sensitive values with the mask. */
export function redactInputs(tool: Tool, inputs: Record<string, unknown>): Record<string, string> {
  const sens = sensitiveParams(tool);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs)) {
    out[k] = sens.has(k) ? MASK : formatValue(v);
  }
  return out;
}

/** Human-readable preview of everything the tool will submit: label from the input schema title or step intent. */
export function buildPreview(tool: Tool, inputs: Record<string, unknown>): PreviewItem[] {
  const sens = sensitiveParams(tool);
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { title?: string }>;
  const items: PreviewItem[] = [];
  const seen = new Set<string>();
  for (const s of tool.steps) {
    const p = stepParam(s);
    if (!p || seen.has(p) || s.action.type === "userInput" || !(p in inputs)) continue;
    seen.add(p);
    const label = props[p]?.title ?? s.intent;
    items.push({ label, value: sens.has(p) ? MASK : formatValue(inputs[p]) });
  }
  return items;
}

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v && typeof v === "object" && "name" in v) return String((v as { name: unknown }).name);
  return v === undefined || v === null ? "" : String(v);
}
