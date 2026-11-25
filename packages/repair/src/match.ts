import type { Condition, Locator, StepContract } from "@mcpify/contracts";
import type { Candidate, ElementKind, EvidencePage } from "./evidence.js";
import { coverage, identSim, textSim, words } from "./text.js";

/** What we know about the element a step used to target, derived only from the step itself. */
export interface OldSignature {
  kind: ElementKind;
  labels: string[];   // label locator values, role names, button texts
  idents: string[];   // id / name / testid values
  near: string[];     // near-locator anchor texts
  intent: string[];   // words of intent + step id + param
}

const KIND_BY_ACTION: Record<string, ElementKind> = {
  fill: "text", userInput: "text", select: "select", check: "check", upload: "file", click: "button",
};

export function signatureOf(step: StepContract): OldSignature {
  const sig: OldSignature = { kind: KIND_BY_ACTION[step.action.type] ?? "text", labels: [], idents: [], near: [], intent: [] };
  for (const l of step.locators) {
    if (l.kind === "label" || l.kind === "text") sig.labels.push(l.value);
    else if (l.kind === "role") {
      sig.labels.push(l.name);
      if (l.role === "link") sig.kind = "link";
    } else if (l.kind === "id" || l.kind === "name" || l.kind === "testid") sig.idents.push(l.value);
    else if (l.kind === "near") sig.near.push(l.anchorText);
  }
  const param = "param" in step.action ? step.action.param : "";
  sig.intent = words(`${step.intent} ${step.id} ${param}`);
  return sig;
}

export interface Scored {
  c: Candidate;
  score: number;
}

const max = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);

/** Weighted score of one candidate; features without data on the old side are left out (renormalised). */
export function scoreCandidate(sig: OldSignature, c: Candidate, prevForm?: string): number {
  const isBtn = c.kind === "button" || c.kind === "link";
  const candLabels = isBtn ? [c.text, ...c.labels] : [c.labelRaw, ...c.labels];
  const feats: [number, number][] = [];
  if (sig.labels.length) feats.push([0.4, max(sig.labels.flatMap((o) => candLabels.filter(Boolean).map((n) => textSim(o, n))))]);
  if (sig.idents.length) feats.push([0.25, max(sig.idents.flatMap((o) => [c.id, c.name, c.testid].filter(Boolean).map((n) => identSim(o, n))))]);
  const own = words(candLabels[0] || "").length ? words(candLabels[0]!) : words(`${c.id} ${c.name}`);
  feats.push([0.25, coverage(own, sig.intent)]);
  if (sig.near.length) feats.push([0.1, max(sig.near.map((o) => textSim(o, c.nearText)))]);
  if (isBtn && prevForm !== undefined) feats.push([0.2, c.form === prevForm ? 1 : 0]);
  const wsum = feats.reduce((s, [w]) => s + w, 0);
  return feats.reduce((s, [w, v]) => s + w * v, 0) / wsum;
}

/** All same-kind candidates, best first. */
export function rank(sig: OldSignature, cands: Candidate[], prevForm?: string): Scored[] {
  return cands
    .filter((c) => c.kind === sig.kind)
    .map((c) => ({ c, score: scoreCandidate(sig, c, prevForm) }))
    .sort((a, b) => b.score - a.score);
}

export const MIN_SCORE = 0.75;
export const MIN_MARGIN = 0.15;

/** Tier-2 decision: best ≥ 0.75 and beats the runner-up by ≥ 0.15. */
export function pickConfident(ranked: Scored[]): Scored | null {
  const [best, second] = ranked;
  if (!best || best.score < MIN_SCORE) return null;
  return best.score - (second?.score ?? 0) >= MIN_MARGIN ? best : null;
}

/** Fresh locators for a candidate (compiler rules: testid > id > name > label > role > text), each verified unique. */
export async function synthesizeLocators(ev: EvidencePage, c: Candidate, old: Locator[]): Promise<Locator[]> {
  const isBtn = c.kind === "button" || c.kind === "link";
  const wish: Locator[] = [];
  if (c.testid) wish.push({ kind: "testid", value: c.testid });
  if (c.id && !/\d{4,}/.test(c.id)) wish.push({ kind: "id", value: c.id });
  if (c.name) wish.push({ kind: "name", value: c.name });
  if (!isBtn && c.labelRaw) wish.push({ kind: "label", value: c.labelRaw });
  if (isBtn && c.text) {
    wish.push({ kind: "role", role: c.kind === "link" ? "link" : "button", name: c.text });
    wish.push({ kind: "text", value: c.text });
  }
  const out: Locator[] = [];
  for (const l of wish) if ((await ev.resolve([l])) === c.i) out.push(l);
  // Owner-mode testids cannot be checked on a page rendered without them: keep the old one first.
  const oldTestid = old.find((l) => l.kind === "testid");
  if (oldTestid && !ev.hasTestIds && !out.some((l) => l.kind === "testid")) out.unshift(oldTestid);
  return out.slice(0, 5);
}

const sameLoc = (a: Locator, b: Locator) => JSON.stringify(a) === JSON.stringify(b);

/** Point every condition that referenced the step's old element at the new locators. */
export function rewriteConditions(conds: Condition[], old: Locator[], fresh: Locator[]): Condition[] {
  return conds.map((c) =>
    "locators" in c && c.locators.some((l) => old.some((o) => sameLoc(o, l))) ? { ...c, locators: fresh } : c,
  );
}

/** The step with new locators and conditions; everything else frozen. */
export function withLocators(step: StepContract, fresh: Locator[]): StepContract {
  return {
    ...step,
    locators: fresh,
    pre: rewriteConditions(step.pre, step.locators, fresh),
    post: rewriteConditions(step.post, step.locators, fresh),
  };
}
