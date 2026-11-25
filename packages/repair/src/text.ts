/** Text similarity helpers used by the heuristic re-match (tier 2). All scores are 0..1. */

/** Same normalisation as the engine's label matching: strip `*`/`:`, collapse whitespace, lower-case. */
export const normText = (s: string): string => s.replace(/[*:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const STOP = new Set([
  "a", "an", "the", "of", "to", "and", "or", "for", "in", "on", "at", "by", "with", "from", "s", "is", "your", "this",
  "per", "fill", "enter", "select", "choose", "tick", "click", "type", "go", "page", "field",
]);

/** Noise tokens of generated/legacy identifiers (ASP.NET prefixes, control-type prefixes, digits). */
const ID_NOISE = /^(ctl\d*|content|place|holder\d*|contentplaceholder\d*|main|body|txt|ddl|chk|btn|fu|lbl|rb|cb|rdo|cmb|input|field|\d+)$/;

/** Words of a phrase or identifier: splits camelCase and punctuation, drops stop words. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));
}

/** Content words of an identifier (id/name/testid) without legacy noise. */
export function identWords(s: string): string[] {
  return words(s).filter((w) => !ID_NOISE.test(w));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 - normalised edit distance. */
export function levSim(a: string, b: string): number {
  if (!a && !b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Small synonym groups for button texts and form vocabulary. */
const SYNONYMS = [
  ["next", "continue", "proceed", "forward"],
  ["back", "previous", "prev"],
  ["submit", "apply", "finish"],
  ["send", "request", "get"],
  ["mobile", "phone", "cell"],
  ["dob", "birth", "born"],
  ["income", "earnings", "salary"],
];
const SYN = new Map<string, number>();
SYNONYMS.forEach((g, i) => g.forEach((w) => SYN.set(w, i)));

/** Fuzzy word match: equal, synonyms, shared 4-letter stem ("annual"/"annum"), or close spelling. */
export function wordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = SYN.get(a);
  if (ga !== undefined && ga === SYN.get(b)) return true;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;
  return a.length >= 5 && b.length >= 5 && levSim(a, b) >= 0.8;
}

/** Token overlap: mean of the overlap coefficient and Jaccard, with fuzzy word matching. */
export function tokenSim(a: string[], b: string[]): number {
  const A = [...new Set(a)];
  const B = [...new Set(b)];
  if (!A.length || !B.length) return 0;
  const matched = A.filter((x) => B.some((y) => wordMatch(x, y))).length;
  const coef = matched / Math.min(A.length, B.length);
  const jac = matched / (A.length + B.length - matched);
  return (coef + jac) / 2;
}

/** Similarity of two human phrases (labels, button texts). */
export function textSim(a: string, b: string): number {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return 0;
  return Math.max(levSim(na, nb), tokenSim(words(na), words(nb)));
}

/** Similarity of two identifiers (id/name/testid), ignoring legacy prefixes. */
export function identSim(a: string, b: string): number {
  const wa = identWords(a);
  const wb = identWords(b);
  if (!wa.length || !wb.length) return 0;
  return Math.max(levSim(wa.join(""), wb.join("")), tokenSim(wa, wb));
}

/** Fraction of `cand` words found (fuzzily) in `context` words. */
export function coverage(cand: string[], context: string[]): number {
  const C = [...new Set(cand)];
  if (!C.length || !context.length) return 0;
  return C.filter((x) => context.some((y) => wordMatch(x, y))).length / C.length;
}

/**
 * Option label similarity, aware of abbreviations: "B.Sc" ~ "Bachelor of Science",
 * "B.Com" ~ "Bachelor of Commerce" (every short token is a prefix of the matching long word).
 */
export function optionSim(oldLabel: string, newLabel: string): number {
  const o = oldLabel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const n = words(newLabel);
  if (o.length && o.length === n.length && o.every((t, i) => n[i]!.startsWith(t))) return o.join("") === n.join("") ? 1 : 0.95;
  return textSim(oldLabel, newLabel);
}
