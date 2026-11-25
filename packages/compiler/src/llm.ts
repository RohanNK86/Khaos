import { z } from 'zod';
import type { RiskClass, StepContract } from '@mcpify/contracts';
import { parseJson, redactForLlm } from '@mcpify/llm';
import { selectableOptions, type ParamSpec, paramSchema } from './schema.js';
import { snake, unique } from './naming.js';
import type { SnapshotDom } from './snapshots.js';
import type { ToolDraft } from './types.js';

/** Output schema of the single LLM call per recording (docs/team/rohan.md R4). */
export const LlmToolSchema = z.object({
  toolName: z.string(),
  title: z.string(),
  description: z.string(),
  params: z.array(z.object({
    stepId: z.string(), paramName: z.string(), label: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'date', 'enum', 'file']),
    enum: z.array(z.string()).optional(), required: z.boolean(), sensitive: z.boolean(),
  })),
  steps: z.array(z.object({ stepId: z.string(), intent: z.string(), riskOverride: z.enum(['read', 'fill', 'commit', 'auth']).optional() })),
  outputs: z.array(z.object({ name: z.string(), description: z.string() })),
});
export type LlmTool = z.infer<typeof LlmToolSchema>;

export const LLM_SYSTEM = [
  'You turn a recorded web-form demonstration into a tool definition for AI agents.',
  'Name every parameter in snake_case from the meaning of its field (e.g. "annual_income", not "txt_income").',
  'Write one clear intent sentence per step. Never invent fields or steps: use only the stepIds given.',
  'Mark identity, OTP, CAPTCHA and password fields as sensitive.',
  'Write a short description that says what the tool does, that it pauses for the user\'s confirmation before sending data,',
  'and that it asks the user for any OTP or CAPTCHA. Values marked ••• or [redacted] are hidden on purpose.',
].join(' ');

const RISK_ORDER: RiskClass[] = ['read', 'fill', 'commit', 'auth'];
/** The LLM may only make a step MORE careful, never less. */
const escalate = (a: RiskClass, b?: RiskClass): RiskClass => (b && RISK_ORDER.indexOf(b) > RISK_ORDER.indexOf(a) ? b : a);

async function stepSummary(s: StepContract, params: ParamSpec[], dom: SnapshotDom | null, snapshots: Map<string, string | undefined>) {
  const p = params.find(x => x.stepId === s.id);
  const excerpt = p && dom ? redactForLlm(await dom.excerpt(snapshots.get(s.id), p.target, 600)) : undefined;
  return {
    stepId: s.id, action: s.action.type, risk: s.risk, intent: s.intent,
    ...(p ? {
      param: p.name, label: p.label, fieldType: p.target.type ?? p.target.tag,
      example: p.sensitive || p.value === undefined ? '•••' : redactForLlm(p.value),
      options: p.kind === 'select' ? selectableOptions(p.target) : undefined, excerpt,
    } : {}),
  };
}

/** The user message: task hint + steps, with sensitive values redacted and short DOM excerpts. */
export async function buildLlmPrompt(draft: ToolDraft, params: ParamSpec[], dom: SnapshotDom | null, snapshots = new Map<string, string | undefined>()): Promise<string> {
  const steps = [];
  for (const s of draft.steps) steps.push(await stepSummary(s, params, dom, snapshots));
  return JSON.stringify({ task: draft.name, startUrl: draft.startUrl, outputs: draft.outputs, steps }, null, 1);
}

interface Renames { params: Map<string, string>; steps: Map<string, string> }

function planRenames(draft: ToolDraft, out: LlmTool): Renames {
  const params = new Map<string, string>();
  const used = new Set<string>();
  const byStep = new Map(out.params.map(p => [p.stepId, p]));
  const stepParams = draft.steps.flatMap(s => ('param' in s.action ? [[s.id, s.action.param] as const] : []));
  for (const [stepId, old] of stepParams) {
    const wanted = snake(byStep.get(stepId)?.paramName ?? '', 6);
    params.set(old, unique(wanted && wanted !== 'value' ? wanted : old, used));
  }
  const steps = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const s of draft.steps) {
    const p = 'param' in s.action ? s.action.param : undefined;
    const renamed = p && s.id.endsWith(`_${p}`) ? s.id.slice(0, -p.length) + params.get(p)! : s.id;
    steps.set(s.id, unique(renamed, usedIds));
  }
  return { params, steps };
}

function renameStep(s: StepContract, r: Renames, out: LlmTool, outputNames: Map<string, string>): StepContract {
  const json = JSON.stringify(s, (key, value) => {
    if (key === 'param' && typeof value === 'string') return r.params.get(value) ?? value;
    if (key === 'as' && typeof value === 'string') return outputNames.get(value) ?? value;
    return value;
  });
  const step = JSON.parse(json) as StepContract;
  const hint = out.steps.find(x => x.stepId === s.id);
  const risk = step.action.type === 'userInput' ? 'auth' : escalate(step.risk, hint?.riskOverride);
  return {
    ...step, id: r.steps.get(s.id)!, intent: hint?.intent?.trim() || step.intent, risk,
    repair: risk === 'commit' || risk === 'auth' ? 'human' : step.repair,
  };
}

/** Merge the LLM's answer into the deterministic draft (safe merge: names and text only; risk can only go up). */
export function mergeLlm(draft: ToolDraft, params: ParamSpec[], out: LlmTool): { draft: ToolDraft; params: ParamSpec[] } {
  const r = planRenames(draft, out);
  const outputNames = new Map<string, string>();
  if (out.outputs.length === draft.outputs.length) {
    draft.outputs.forEach((o, i) => outputNames.set(o, snake(out.outputs[i]!.name, 6) || o));
  }
  const byStep = new Map(out.params.map(p => [p.stepId, p]));
  const merged = params.map(p => {
    const hint = byStep.get(p.stepId);
    return { ...p, name: r.params.get(p.name) ?? p.name, stepId: r.steps.get(p.stepId) ?? p.stepId, label: hint?.label?.trim() || p.label, sensitive: p.sensitive || Boolean(hint?.sensitive) };
  });
  const properties: Record<string, unknown> = {};
  merged.forEach((p, i) => {
    if (p.kind === 'userInput') return;
    const schema = paramSchema(p);
    const hint = byStep.get(params[i]!.stepId);
    if (schema.type === 'string' && !schema.enum && !schema.format && hint?.type === 'date') Object.assign(schema, { format: 'date', description: 'YYYY-MM-DD' });
    if (p.sensitive) schema.sensitive = true;
    properties[p.name] = schema;
  });
  const examples = Object.fromEntries(Object.entries(draft.examples).filter(([k]) => !merged.find(p => p.name === (r.params.get(k) ?? k))?.sensitive).map(([k, v]) => [r.params.get(k) ?? k, v]));
  return {
    params: merged,
    draft: {
      ...draft,
      name: /^[a-z][a-z0-9_]{1,40}$/.test(out.toolName) ? out.toolName : draft.name,
      title: out.title.trim() || draft.title,
      description: out.description.trim() || draft.description,
      inputSchema: { ...draft.inputSchema, properties, required: ((draft.inputSchema.required as string[]) ?? []).map(k => r.params.get(k) ?? k) },
      outputs: draft.outputs.map(o => outputNames.get(o) ?? o),
      steps: draft.steps.map(s => renameStep(s, r, out, outputNames)),
      examples,
    },
  };
}

/** One structured-output call per recording; on any LLM error the rules-only draft is kept (with a warning). */
export async function llmPass(draft: ToolDraft, params: ParamSpec[], dom: SnapshotDom | null, snapshots?: Map<string, string | undefined>): Promise<ToolDraft> {
  try {
    const out = await parseJson(LlmToolSchema, LLM_SYSTEM, await buildLlmPrompt(draft, params, dom, snapshots), { maxTokens: 8000 });
    const merged = mergeLlm(draft, params, out).draft;
    if (merged.steps.some(s => s.risk === 'commit') && !/confirm/i.test(merged.description)) {
      merged.description += " It pauses for the user's confirmation before sending data.";
    }
    return merged;
  } catch (e) {
    return { ...draft, warnings: [...draft.warnings, `LLM pass skipped: ${(e as Error).message}`] };
  }
}
