import type { BrowserContext } from "playwright";

export interface BlockedRequest {
  method: string;
  url: string;
  at: string;
}

/**
 * Dry-run network guard: abort every request that could send data (anything but GET/HEAD/OPTIONS).
 * Second line of defence next to the engine's commit-step block. Returns the live list of blocked requests.
 */
export async function installNetworkGuard(ctx: BrowserContext, onBlocked?: (r: BlockedRequest) => void): Promise<BlockedRequest[]> {
  const blocked: BlockedRequest[] = [];
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    if (["GET", "HEAD", "OPTIONS"].includes(req.method())) return route.continue();
    const b = { method: req.method(), url: req.url(), at: new Date().toISOString() };
    blocked.push(b);
    onBlocked?.(b);
    return route.abort("blockedbyclient");
  });
  return blocked;
}
