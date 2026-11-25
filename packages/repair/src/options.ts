import type { StepContract, Tool } from "@mcpify/contracts";
import type { Candidate } from "./evidence.js";
import { normText, optionSim } from "./text.js";

/** param → (old option label → new option label). */
export type OptionAliases = Record<string, Record<string, string>>;

const MIN_OPTION_SIM = 0.75;
const MARKER = "option-aliases: ";

const hasOption = (c: Candidate, want: string) =>
  c.options.some((o) => normText(o.label) === normText(want) || o.value === want);

/** Labels the tool knows for a select param: the input schema enum, plus the example value. */
function knownLabels(tool: Tool, param: string, example?: unknown): string[] {
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { enum?: unknown[] }>;
  const fromEnum = (props[param]?.enum ?? []).map(String);
  return [...new Set([...fromEnum, ...(example !== undefined ? [String(example)] : [])])];
}

/**
 * For a `select` step whose element still matches but whose options were relabelled (M9): map every known
 * old label that is no longer an option to its new label. Returns null when nothing is missing, or the
 * mapping is incomplete/ambiguous. `score` is the weakest link of the mapping.
 */
export function mapOptions(
  tool: Tool, step: StepContract, c: Candidate, example?: unknown,
): { aliases: Record<string, string>; score: number } | null | "not_needed" {
  if (step.action.type !== "select") return "not_needed";
  const missing = knownLabels(tool, step.action.param, example).filter((l) => !hasOption(c, l));
  if (!missing.length) return "not_needed";
  const real = c.options.filter((o) => o.value !== "0" && o.value !== "" && !/^-+.*-+$/.test(o.label));
  const aliases: Record<string, string> = {};
  let score = 1;
  for (const old of missing) {
    const ranked = real.map((o) => ({ o, s: optionSim(old, o.label) })).sort((a, b) => b.s - a.s);
    const [best, second] = ranked;
    if (!best || best.s < MIN_OPTION_SIM || (second && best.s - second.s < 0.15)) return null;
    aliases[old] = best.o.label;
    score = Math.min(score, best.s);
  }
  const targets = Object.values(aliases);
  if (new Set(targets).size !== targets.length) return null; // two old labels onto one new label
  return { aliases, score };
}

/** Machine-readable suffix appended to a proposal's `reason` (StepContract has no field for it). */
export const encodeAliases = (param: string, aliases: Record<string, string>) => `${MARKER}${JSON.stringify({ [param]: aliases })}`;

/** Read the option mapping back out of a proposal (null if it has none). */
export function optionAliases(proposal: { reason: string }): OptionAliases | null {
  const at = proposal.reason.lastIndexOf(MARKER);
  if (at < 0) return null;
  try {
    return JSON.parse(proposal.reason.slice(at + MARKER.length)) as OptionAliases;
  } catch {
    return null;
  }
}

/** Translate agent inputs through the mapping, e.g. { course: "B.Sc" } → { course: "Bachelor of Science" }. */
export function applyOptionAliases(inputs: Record<string, unknown>, aliases: OptionAliases): Record<string, unknown> {
  const out = { ...inputs };
  for (const [param, map] of Object.entries(aliases)) {
    const v = out[param];
    if (typeof v === "string" && map[v] !== undefined) out[param] = map[v];
  }
  return out;
}
