import { RecordingSchema, type Condition, type ElementFingerprint, type Locator, type Recording, type StepContract } from '@mcpify/contracts';
import { llmAvailable } from '@mcpify/llm';
import { LocalBlobStore, apiUrl, siteByOrigin } from '@mcpify/recorder';
import { candidateLocators, pickLocators } from './locators.js';
import { llmPass } from './llm.js';
import {
  escapeRegex, humanize, paramNameFromLabel, patternFromValue, sensitiveParamName, snake, stripStepPrefix, unique, userInputPrompt,
} from './naming.js';
import { planSteps } from './plan.js';
import { classifyClick, clickText, repairFor } from './risk.js';
import { buildExamples, buildInputSchema, type ParamSpec } from './schema.js';
import { SnapshotDom, type PageFacts } from './snapshots.js';
import type { CompileOptions, PlannedStep, ToolDraft } from './types.js';

const CLICK_TIMEOUT_MS = 15000;

/** Default snapshot loader: local blob dir, then the API's blob store. */
export async function defaultLoadSnapshot(blobId: string): Promise<string | null> {
  const local = await new LocalBlobStore().get(blobId);
  if (local) return local.content.toString('utf8');
  try {
    const res = await fetch(`${apiUrl()}/blobs/${blobId}`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search; };
const urlPattern = (url: string) => `${escapeRegex(pathOf(url))}$`;

/** Everything compile needs while turning planned steps into contracts. */
interface Ctx {
  dom: SnapshotDom | null;
  warnings: string[];
  stepIds: Set<string>;
  paramNames: Set<string>;
  params: ParamSpec[];
  /** url path → page facts, for every page the recording saw */
  pages: Map<string, PageFacts>;
  /** step id → snapshot its element was verified against (for LLM excerpts) */
  snapshots: Map<string, string | undefined>;
}

async function collectPages(ctx: Ctx, planned: PlannedStep[]): Promise<void> {
  for (const p of planned) {
    const shots: [string, string | undefined][] = [[p.event.url, p.snapshotId]];
    if (p.after) shots.push([p.after.url, p.after.snapshotId]);
    for (const [url, id] of shots) {
      if (ctx.pages.has(pathOf(url)) || !id || !ctx.dom) continue;
      const facts = await ctx.dom.facts(id);
      if (facts) ctx.pages.set(pathOf(url), facts);
    }
  }
}

/** The first heading of a page that no other recorded page shows ("Personal Details", not the portal name). */
function distinctiveHeading(ctx: Ctx, url: string, facts?: PageFacts | null): string | undefined {
  const mine = facts ?? ctx.pages.get(pathOf(url));
  if (!mine) return undefined;
  const others = new Set([...ctx.pages].filter(([path]) => path !== pathOf(url)).flatMap(([, f]) => f.headings.map(h => stripStepPrefix(h).toLowerCase())));
  return mine.headings.map(stripStepPrefix).find(h => h && !others.has(h.toLowerCase()));
}

/** Text that appeared after an action (e.g. "OTP has been sent ..."), preferring success-like sentences. */
async function newText(ctx: Ctx, beforeId?: string, afterId?: string): Promise<string | undefined> {
  if (!ctx.dom || !afterId) return undefined;
  const before = new Set((await ctx.dom.facts(beforeId))?.lines ?? []);
  const fresh = ((await ctx.dom.facts(afterId))?.lines ?? []).filter(l => !before.has(l) && l.split(' ').length >= 3 && l.length <= 200);
  const best = fresh.find(l => /sent|success|saved|submitted|thank|received|verified|updated|done/i.test(l)) ?? fresh[0];
  return best?.split(/(?<=[.!])\s/)[0];
}

async function locatorsFor(ctx: Ctx, step: PlannedStep, target: ElementFingerprint, label?: string): Promise<Locator[]> {
  const candidates = candidateLocators(target, { label });
  const check = ctx.dom ? await ctx.dom.verify(step.snapshotId, candidates, target) : null;
  if (check && !check.targetFound) ctx.warnings.push(`event #${step.event.seq}: recorded element not found in its snapshot; locators checked for uniqueness only`);
  const { locators, verified } = pickLocators(candidates, check?.ok ?? null);
  if (!verified) ctx.warnings.push(`event #${step.event.seq}: locators could not be verified against a DOM snapshot`);
  return locators;
}

function stepId(ctx: Ctx, base: string): string {
  return unique(snake(base, 8) || 'step', ctx.stepIds);
}

function navigateStep(ctx: Ctx, p: PlannedStep, first: boolean): StepContract {
  const heading = distinctiveHeading(ctx, p.event.url);
  const title = ctx.pages.get(pathOf(p.event.url))?.title;
  const post: Condition[] = [{ kind: 'urlMatches', pattern: urlPattern(p.event.url) }];
  if (heading) post.push({ kind: 'textPresent', text: heading });
  return {
    id: stepId(ctx, first ? 'open_start_page' : `open_${heading ?? 'page'}`),
    intent: `Open ${heading ? `the ${heading} page` : title || p.event.url}`,
    action: { type: 'navigate', url: p.event.url }, locators: [], pre: [], post, risk: 'read', repair: 'auto',
  };
}

function fieldLabel(t: ElementFingerprint) {
  return t.label ?? t.ariaLabel ?? t.placeholder;
}

/** Select events may carry the option value (older recordings); the engine and the schema use labels. */
function optionLabel(t: ElementFingerprint, value: string | undefined): string | undefined {
  if (value === undefined || !t.options) return value;
  if (t.options.some(o => o.label === value)) return value;
  return t.options.find(o => o.value === value)?.label ?? value;
}

function userInputIntent(param: string, what: string): string {
  if (param === 'otp') return 'Enter the OTP the user received on their mobile';
  if (param === 'captcha') return 'Enter the CAPTCHA characters the user reads from the page';
  return `Enter the ${what} value the user provides`;
}

const VALUE_VERB: Record<string, string> = { fill: 'enter', select: 'select', check: 'check', upload: 'upload', userInput: 'enter' };

async function valueStep(ctx: Ctx, p: PlannedStep): Promise<StepContract> {
  const t = p.target!;
  const kind = p.kind as ParamSpec['kind'];
  const label = fieldLabel(t);
  const masked = kind === 'userInput';
  const base = masked
    ? sensitiveParamName([label, t.name, t.id, t.placeholder]) ?? paramNameFromLabel(label, [t.name, t.id])
    : paramNameFromLabel(label, [t.placeholder, t.ariaLabel, t.name, t.id]);
  const name = unique(base, ctx.paramNames);
  const verb = kind === 'check' && /declar|agree|accept|consent|terms/i.test(label ?? '') ? 'accept' : VALUE_VERB[kind]!;
  const id = stepId(ctx, `${verb}_${name}`);
  ctx.snapshots.set(id, p.snapshotId);
  ctx.params.push({ name, stepId: id, kind, label, target: t, value: masked ? undefined : kind === 'select' ? optionLabel(t, p.value) : p.value, sensitive: masked });
  const locators = await locatorsFor(ctx, p, t, label);
  const what = label ? `"${label}"` : humanize(name).toLowerCase();
  const base0 = { id, locators, pre: [{ kind: 'visible', locators }] as Condition[] };
  if (masked) {
    return { ...base0, intent: userInputIntent(name, what), action: { type: 'userInput', param: name, prompt: userInputPrompt(name, label) }, post: [], risk: 'auth', repair: 'human', sensitive: true };
  }
  if (kind === 'upload') return { ...base0, intent: `Upload the ${what} file`, action: { type: 'upload', param: name }, post: [], risk: 'fill', repair: 'auto' };
  const post: Condition[] = [{ kind: 'valueEquals', locators, param: name }, { kind: 'noErrorNear', locators }];
  const intent = kind === 'check' ? `Tick ${what}` : kind === 'select' ? `Select the ${what} option` : `Fill the ${what} field`;
  return { ...base0, intent, action: { type: kind as 'fill' | 'select' | 'check', param: name }, post, risk: 'fill', repair: 'auto' };
}

/** `submit` events (Enter in a field) become a click on the form's submit button. */
async function clickTarget(ctx: Ctx, p: PlannedStep): Promise<ElementFingerprint | null> {
  if (p.target!.tag !== 'form') return p.target!;
  const button = ctx.dom ? await ctx.dom.formButton(p.snapshotId, p.target!) : null;
  if (!button) ctx.warnings.push(`event #${p.event.seq}: form submitted with Enter but no submit button was found; skipped`);
  return button;
}

async function clickStep(ctx: Ctx, p: PlannedStep, isLastClick: boolean): Promise<StepContract | null> {
  const target = await clickTarget(ctx, p);
  if (!target) return null;
  const afterFacts = p.after?.snapshotId && ctx.dom ? await ctx.dom.facts(p.after.snapshotId) : null;
  const risk = p.kind === 'radio' ? 'fill' : classifyClick(target, { fromUrl: p.event.url, after: p.after, afterFacts, isLastClick });
  const text = clickText(target);
  const locators = await locatorsFor(ctx, { ...p, target }, target);
  const movedTo = p.after?.navigated && pathOf(p.after.url) !== pathOf(p.event.url) ? p.after.url : undefined;
  const post: Condition[] = [];
  if (movedTo) post.push({ kind: 'urlMatches', pattern: urlPattern(movedTo) });
  else {
    const appeared = await newText(ctx, p.beforeId ?? p.snapshotId, p.after?.snapshotId);
    if (appeared) post.push({ kind: 'textPresent', text: appeared });
  }
  const heading = movedTo ? distinctiveHeading(ctx, movedTo, afterFacts) : undefined;
  let id: string;
  let intent: string;
  if (risk === 'fill' && movedTo) {
    id = `continue_to_${heading ?? 'next_page'}`;
    intent = `Save this page and go to the ${heading ? `${heading.toLowerCase()} page` : 'next page'}`;
  } else if (risk === 'read') {
    id = `open_${text || 'link'}`;
    intent = `Open "${text}"`;
  } else {
    id = text ? snake(text) : `click_${snake(target.label ?? target.id ?? 'button')}`;
    intent = risk === 'commit' ? `Click "${text}" (sends data to the site)` : `Click "${text || target.label || 'button'}"`;
  }
  return {
    id: stepId(ctx, id), intent, action: { type: 'click' }, locators, pre: [{ kind: 'visible', locators }], post,
    risk, repair: repairFor(risk), ...(p.kind === 'radio' ? {} : { timeoutMs: CLICK_TIMEOUT_MS }),
  };
}

/** After the last click, read a generated reference (Application ID, Reference No, ...) from the final page. */
async function extractStep(ctx: Ctx, last: PlannedStep | undefined): Promise<{ step: StepContract; output: string } | null> {
  if (!ctx.dom || !last?.after?.snapshotId) return null;
  const found = (await ctx.dom.outputs(last.after.snapshotId))[0];
  if (!found) return null;
  const output = snake(found.label || 'reference_id', 4) || 'reference_id';
  const shot: PlannedStep = { kind: 'click', event: last.event, snapshotId: last.after.snapshotId };
  const locators = await locatorsFor(ctx, shot, found.target, found.label || undefined);
  return {
    output,
    step: {
      id: stepId(ctx, `read_${output}`), intent: `Read the ${found.label || 'reference number'} from the confirmation page`,
      action: { type: 'extract' }, locators, pre: [],
      post: [{ kind: 'extract', locators, as: output, pattern: patternFromValue(found.value) }], risk: 'read', repair: 'auto',
    },
  };
}

function describe(title: string, siteName: string, steps: StepContract[], outputs: string[]): string {
  const commits = steps.filter(s => s.risk === 'commit').map(s => clickTextFromIntent(s.intent));
  const asks = steps.filter(s => s.action.type === 'userInput').map(s => ('param' in s.action ? s.action.param.toUpperCase() : ''));
  const fields = steps.filter(s => ['fill', 'select', 'check', 'upload'].includes(s.action.type)).length;
  const parts = [`${title} on ${siteName}.`, `Fills ${fields} form field${fields === 1 ? '' : 's'}.`];
  if (commits.length) parts.push(`It PAUSES for the user's confirmation before ${commits.map(c => `"${c}"`).join(' and before ')}.`);
  if (asks.length) parts.push(`It asks the user for the ${asks.join(' and the ')} (never stored).`);
  if (outputs.length) parts.push(`Returns ${outputs.join(', ')}.`);
  return parts.join(' ');
}
const clickTextFromIntent = (intent: string) => intent.match(/"([^"]+)"/)?.[1] ?? intent;

async function buildSteps(ctx: Ctx, planned: PlannedStep[]): Promise<{ steps: StepContract[]; outputs: string[] }> {
  const steps: StepContract[] = [];
  const clicks = planned.filter(p => p.kind === 'click');
  for (const p of planned) {
    if (p.kind === 'navigate') steps.push(navigateStep(ctx, p, steps.length === 0));
    else if (p.kind === 'click' || p.kind === 'radio') {
      const s = await clickStep(ctx, p, p === clicks.at(-1));
      if (s) steps.push(s);
    } else steps.push(await valueStep(ctx, p));
  }
  const extract = await extractStep(ctx, clicks.at(-1));
  if (extract) steps.push(extract.step);
  return { steps, outputs: extract ? [extract.output] : [] };
}

/**
 * Compile a Recording into a draft Tool: deterministic pass (steps, risk, verified locators, conditions, params),
 * then an optional LLM pass (names, intents, title, description) when an LLM is configured.
 */
export async function compile(input: Recording, opts: CompileOptions = {}): Promise<ToolDraft> {
  const recording = RecordingSchema.parse(input);
  const ctx: Ctx = { dom: null, warnings: [], stepIds: new Set(), paramNames: new Set(), params: [], pages: new Map(), snapshots: new Map() };
  const planned = planSteps(recording.events, ctx.warnings);
  try {
    ctx.dom = await SnapshotDom.open(opts.loadSnapshot ?? defaultLoadSnapshot);
  } catch (e) {
    ctx.warnings.push(`no browser for snapshot checks (${(e as Error).message.split('\n')[0]}); locators are unverified`);
  }
  try {
    await collectPages(ctx, planned);
    const { steps, outputs } = await buildSteps(ctx, planned);
    const site = opts.siteId ? undefined : await siteByOrigin(recording.siteOrigin);
    const name = /^[a-z][a-z0-9_]{1,40}$/.test(recording.taskName) ? recording.taskName : snake(recording.taskName, 6) || 'recorded_task';
    const title = humanize(name);
    let draft: ToolDraft = {
      siteId: opts.siteId ?? site?.id, name, title,
      description: describe(title, opts.siteName ?? site?.name ?? recording.siteOrigin, steps, outputs),
      status: 'draft', inputSchema: buildInputSchema(ctx.params), outputs, startUrl: recording.startUrl, steps,
      createdFrom: recording.id, examples: buildExamples(ctx.params), warnings: ctx.warnings,
    };
    if (opts.llm !== false && llmAvailable()) draft = await llmPass(draft, ctx.params, ctx.dom, ctx.snapshots);
    return draft;
  } finally {
    await ctx.dom?.close();
  }
}
