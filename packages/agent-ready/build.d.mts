export function inPageSource(): Promise<string>;
export function inPagePlugin(src: string): unknown;
export function buildMcpifyJs(opts?: { minify?: boolean; outfile?: string }): Promise<void>;
