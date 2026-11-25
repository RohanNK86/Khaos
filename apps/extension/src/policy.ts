/** Which origins may run for real. Everything else is dry-run with the strict network guard. */

declare const __MCPIFY_EXTRA_DEMO_ORIGINS__: string[] | undefined;

export const DEMO_ORIGINS: readonly string[] = [
  "http://localhost:5101", "http://localhost:5102", "http://localhost:5103",
  // Test builds only (build.mjs `extraDemoOrigins`); empty in the shipped extension.
  ...(typeof __MCPIFY_EXTRA_DEMO_ORIGINS__ !== "undefined" ? __MCPIFY_EXTRA_DEMO_ORIGINS__ : []),
];

export interface DryRunPolicy {
  isDemo: boolean;
  /** Initial dry-run toggle. */
  dryRunDefault: boolean;
  /** Dry-run cannot be turned off. */
  dryRunForced: boolean;
  /** The strict network guard (block every POST/PUT/PATCH/DELETE from the tab) cannot be turned off. */
  guardForced: boolean;
}

export function policyFor(origin: string | null): DryRunPolicy {
  const isDemo = origin !== null && DEMO_ORIGINS.includes(origin);
  return { isDemo, dryRunDefault: !isDemo, dryRunForced: !isDemo, guardForced: !isDemo };
}

export interface RunSafety {
  dryRun: boolean;
  strictGuard: boolean;
}

/** Apply the policy to what the user picked: forced settings always win. */
export function effectiveSafety(policy: DryRunPolicy, picked: RunSafety): RunSafety {
  const dryRun = policy.dryRunForced || picked.dryRun;
  return { dryRun, strictGuard: policy.guardForced || (dryRun && picked.strictGuard) };
}

export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}
