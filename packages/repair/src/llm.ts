import { z } from "zod";
import type { StepContract } from "@mcpify/contracts";
import { llmAvailable, parseJson, redactForLlm } from "@mcpify/llm";
import type { Candidate } from "./evidence.js";
import type { OldSignature } from "./match.js";

const MAX_CANDIDATES = 40;

export const LlmPickSchema = z.object({
  index: z.number().int().describe("index of the matching candidate, or -1 if none matches"),
  reason: z.string().describe("one short sentence"),
});
export type LlmPick = z.infer<typeof LlmPickSchema>;

const SYSTEM = [
  "You repair a broken browser-automation step on a web form whose layout changed.",
  "You get the step's intent, what the old element looked like, and a list of candidate elements on the new page.",
  "Answer with the index of the candidate that is clearly the same form element, or -1 if none is.",
  "Never guess: if two candidates are equally plausible, answer -1.",
].join(" ");

/** Compact, value-free view of a candidate for the prompt. */
const compact = (c: Candidate) => ({
  index: c.i, tag: c.tag, type: c.type || undefined, label: c.labelRaw || undefined,
  id: c.id || undefined, name: c.name || undefined, text: c.text || undefined,
});

/**
 * Tier 3: ask Claude (through @mcpify/llm) for the matching candidate. Returns null when the LLM is
 * unavailable, the step is sensitive, the call fails, or the answer is "none".
 */
export async function llmPick(step: StepContract, sig: OldSignature, cands: Candidate[]): Promise<(LlmPick & { c: Candidate }) | null> {
  if (!llmAvailable() || step.sensitive || !cands.length) return null;
  const list = cands.slice(0, MAX_CANDIDATES);
  const user = redactForLlm(JSON.stringify({
    intent: step.intent,
    action: step.action.type,
    oldElement: { kind: sig.kind, labels: sig.labels, identifiers: sig.idents, nearText: sig.near },
    candidates: list.map(compact),
  }));
  try {
    const pick = await parseJson(LlmPickSchema, SYSTEM, user, { maxTokens: 1000, effort: "low" });
    const c = list.find((x) => x.i === pick.index);
    return c ? { ...pick, c } : null;
  } catch {
    return null; // tier 3 is best effort; the proposal falls back to "pending"
  }
}
