import type { Tool } from "@mcpify/contracts";

export type FieldKind = "text" | "email" | "date" | "number" | "integer" | "boolean" | "enum" | "file";

export interface FormField {
  key: string;
  title: string;
  description?: string;
  kind: FieldKind;
  options?: string[];
  required: boolean;
  sensitive: boolean;
  pattern?: string;
  defaultValue?: string | boolean;
}

interface PropSchema {
  type?: string; format?: string; enum?: unknown[]; title?: string; description?: string;
  sensitive?: boolean; pattern?: string; default?: unknown; const?: unknown;
}

function kindOf(p: PropSchema, isUpload: boolean): FieldKind {
  if (isUpload) return "file";
  if (Array.isArray(p.enum)) return "enum";
  if (p.type === "boolean") return "boolean";
  if (p.type === "integer") return "integer";
  if (p.type === "number") return "number";
  if (p.format === "date") return "date";
  if (p.format === "email") return "email";
  return "text";
}

/** One form field per input-schema property, in schema order. Upload params become file pickers. */
export function formFields(tool: Tool): FormField[] {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, PropSchema>;
  const required = new Set((tool.inputSchema.required ?? []) as string[]);
  const uploads = new Set(tool.steps.flatMap((s) => (s.action.type === "upload" ? [s.action.param] : [])));
  return Object.entries(props).map(([key, p]) => {
    const f: FormField = {
      key, title: p.title ?? key, kind: kindOf(p, uploads.has(key)), required: required.has(key), sensitive: p.sensitive === true,
    };
    if (p.description) f.description = p.description;
    if (Array.isArray(p.enum)) f.options = p.enum.map(String);
    if (p.pattern) f.pattern = p.pattern;
    if (typeof p.default === "string" || typeof p.default === "boolean") f.defaultValue = p.default;
    return f;
  });
}

export type RawValues = Record<string, string | boolean | undefined>;

/** Turn raw form values into typed tool inputs, with one error message per bad field. */
export function coerceInputs(fields: FormField[], raw: RawValues): { inputs: Record<string, unknown>; errors: Record<string, string> } {
  const inputs: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = raw[f.key];
    if (f.kind === "boolean") {
      if (v === true) inputs[f.key] = true;
      else if (f.required) errors[f.key] = "Please tick this box.";
      continue;
    }
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) {
      if (f.required) errors[f.key] = "Required.";
      continue;
    }
    if (f.kind === "integer" || f.kind === "number") {
      const n = Number(s);
      if (!Number.isFinite(n) || (f.kind === "integer" && !Number.isInteger(n))) { errors[f.key] = "Enter a number."; continue; }
      inputs[f.key] = n;
      continue;
    }
    if (f.options && !f.options.includes(s)) { errors[f.key] = `Choose one of: ${f.options.join(", ")}.`; continue; }
    if (f.pattern && !new RegExp(f.pattern).test(s)) { errors[f.key] = "Wrong format."; continue; }
    inputs[f.key] = s;
  }
  return { inputs, errors };
}
