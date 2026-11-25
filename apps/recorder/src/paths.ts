import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root (override with MCPIFY_ROOT). `pnpm --filter` runs scripts inside the package, so never trust cwd. */
export const ROOT = process.env.MCPIFY_ROOT ?? resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const fromRoot = (...parts: string[]) => resolve(ROOT, ...parts);
/** Resolve a path the user typed, relative to where they typed it (pnpm sets INIT_CWD). */
export const fromUser = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);
