import type { BrowserContext } from 'playwright';

/**
 * Dry-run guard for recording on real sites: aborts every request that could send data (non GET/HEAD/OPTIONS).
 * Same behaviour as `@mcpify/engine/network-guard` installNetworkGuard; the recorder does not depend on the
 * engine package yet, so this is a local copy. Switch to the engine's once the dependency is added.
 */
export async function installDryRunGuard(ctx: BrowserContext, onBlocked: (method: string, url: string) => void): Promise<void> {
  await ctx.route('**/*', async route => {
    const req = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.continue();
    onBlocked(req.method(), req.url());
    return route.abort('blockedbyclient');
  });
}
