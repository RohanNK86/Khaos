import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Repo root (override with MCPIFY_ROOT). */
export const ROOT = process.env.MCPIFY_ROOT ?? resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const DATA = resolve(ROOT, process.env.MCPIFY_DATA ?? ".data");
export const p = (...parts: string[]) => resolve(ROOT, ...parts);
