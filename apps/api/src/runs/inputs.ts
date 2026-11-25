import type { Tool } from "@mcpify/contracts";

interface Prop { type?: string; enum?: unknown[]; pattern?: string; default?: unknown; const?: unknown; title?: string }

/** Light JSON-Schema checks + coercion for agent-supplied inputs. Returns errors in plain words. */
export function prepareInputs(tool: Tool, raw: Record<string, unknown>): { inputs: Record<string, unknown>; errors: string[] } {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, Prop>;
  const required = (tool.inputSchema.required ?? []) as string[];
  const inputs: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [k, prop] of Object.entries(props)) {
    let v = raw[k];
    if (v === undefined || v === "") {
      if (prop.default !== undefined) v = prop.default;
      else {
        if (required.includes(k)) errors.push(`${k} (${prop.title ?? k}) is required`);
        continue;
      }
    }
    if ((prop.type === "integer" || prop.type === "number") && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, ""))) v = Number(v.replace(/,/g, ""));
    if (prop.type === "boolean" && typeof v === "string") v = v === "true" || v === "yes";
    if (prop.type === "string" && typeof v === "number") v = String(v);
    if (prop.enum) {
      const hit = prop.enum.find((e) => String(e).toLowerCase() === String(v).toLowerCase());
      if (hit === undefined) errors.push(`${k} must be one of: ${prop.enum.join(", ")}`);
      else v = hit;
    }
    if (prop.pattern && typeof v === "string" && !new RegExp(prop.pattern).test(v)) errors.push(`${k} has the wrong format`);
    if (prop.const !== undefined && v !== prop.const) errors.push(`${k} must be ${JSON.stringify(prop.const)}`);
    inputs[k] = v;
  }
  return { inputs, errors };
}
