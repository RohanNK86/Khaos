import type { ElementFingerprint, RiskClass } from '@mcpify/contracts';
import { isLink } from './locators.js';
import type { PageFacts } from './snapshots.js';

export const NEXT_RE = /^\s*(next|continue|proceed|go to next|next page|next step)\b/i;
export const COMMIT_RE = /submit|send|pay|confirm|save|apply|register|book|sign\s*(in|up)|log\s*in|finish|place order/i;

export interface ClickContext {
  fromUrl: string;
  after?: { url: string; navigated: boolean };
  afterFacts?: PageFacts | null;
  isLastClick: boolean;
}

/** Visible text of a clickable element (button value, link text, aria-label). */
export const clickText = (fp: ElementFingerprint) => fp.text ?? fp.ariaLabel ?? fp.label ?? '';

/** True when the click moved to another page of the same origin that still has form fields (next page of a form). */
function leadsToNextFormPage(ctx: ClickContext): boolean {
  if (!ctx.after?.navigated || !ctx.afterFacts) return false;
  const from = new URL(ctx.fromUrl);
  const to = new URL(ctx.after.url);
  return from.origin === to.origin && from.pathname + from.search !== to.pathname + to.search && ctx.afterFacts.controls > 0;
}

/**
 * Risk of a click (01-CONTRACTS §15):
 * Next-style buttons that lead to the next page of the same form only save a draft → fill;
 * anything that sends/pays/confirms, and the last button of the task → commit;
 * plain links → read; other submit buttons → commit (safe default); other buttons → fill.
 */
export function classifyClick(fp: ElementFingerprint, ctx: ClickContext): RiskClass {
  const text = clickText(fp);
  if (NEXT_RE.test(text) && !COMMIT_RE.test(text) && !ctx.isLastClick && leadsToNextFormPage(ctx)) return 'fill';
  if (COMMIT_RE.test(text) || ctx.isLastClick) return 'commit';
  if (isLink(fp)) return 'read';
  const submits = fp.tag === 'input' ? /^(submit|image)$/.test(fp.type ?? '') : fp.tag === 'button' && (fp.type ?? 'submit') === 'submit';
  return submits && fp.inForm ? 'commit' : 'fill';
}

export const repairFor = (risk: RiskClass) => (risk === 'commit' || risk === 'auth' ? 'human' : 'auto') as 'human' | 'auto';
