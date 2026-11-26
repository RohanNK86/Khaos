/** Small stats helpers for benchmark summaries. */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const round = (x: number, d = 0) => Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : NaN;
