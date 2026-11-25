import type { ElementFingerprint, JSONSchema } from '@mcpify/contracts';

/** A tool parameter discovered from one step. */
export interface ParamSpec {
  name: string;
  stepId: string;
  kind: 'fill' | 'select' | 'check' | 'upload' | 'userInput';
  label?: string;
  target: ElementFingerprint;
  /** Recorded example (never present for sensitive params). */
  value?: string;
  sensitive: boolean;
}

const PLACEHOLDER_OPTION = /^(-+.*-+|select\b.*|choose\b.*|please select.*|none)$/i;

/** Option labels a user can pick (drops "--Select--" style placeholders). */
export function selectableOptions(fp: ElementFingerprint): string[] {
  return (fp.options ?? [])
    .filter(o => o.label && !['', '0', '-1'].includes(o.value) && !PLACEHOLDER_OPTION.test(o.label))
    .map(o => o.label);
}

const isDate = (p: ParamSpec) => p.target.type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(p.value ?? '');

/** JSON Schema for one param (01-CONTRACTS §15: `title` is the preview label). */
export function paramSchema(p: ParamSpec): Record<string, unknown> {
  const title = p.label ?? p.name;
  if (p.kind === 'check') return { type: 'boolean', title };
  if (p.kind === 'upload') return { type: 'string', title, default: p.value, description: 'File name in the MCPify file store' };
  if (p.kind === 'select') {
    const options = selectableOptions(p.target);
    return options.length ? { type: 'string', enum: options, title } : { type: 'string', title };
  }
  if (p.target.type === 'number') return { type: /^-?\d+$/.test(p.value ?? '') ? 'integer' : 'number', title };
  if (isDate(p)) return { type: 'string', format: 'date', title, description: 'YYYY-MM-DD' };
  if (p.target.type === 'email') return { type: 'string', format: 'email', title };
  return { type: 'string', title, ...(p.sensitive ? { sensitive: true } : {}) };
}

/** inputSchema for the tool. userInput params (OTP, CAPTCHA) come from the human at run time, so they are not inputs. */
export function buildInputSchema(params: ParamSpec[]): JSONSchema {
  const inputs = params.filter(p => p.kind !== 'userInput');
  return {
    type: 'object',
    properties: Object.fromEntries(inputs.map(p => [p.name, paramSchema(p)])),
    required: inputs.filter(p => p.kind !== 'upload').map(p => p.name),
    additionalProperties: false,
  };
}

/** Recorded example values typed for the schema (sensitive params excluded). */
export function buildExamples(params: ParamSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    if (p.sensitive || p.kind === 'userInput' || p.value === undefined) continue;
    const schema = paramSchema(p);
    if (schema.type === 'boolean') out[p.name] = p.value === 'true';
    else if (schema.type === 'integer' || schema.type === 'number') out[p.name] = Number(p.value);
    else out[p.name] = p.value;
  }
  return out;
}
