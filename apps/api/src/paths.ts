import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Repo root (override with MCPIFY_ROOT). */
export const ROOT = process.env.MCPIFY_ROOT ?? resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const p = (...parts: string[]) => resolve(ROOT, ...parts);
export const DATA = p(process.env.MCPIFY_DATA ?? ".data");

/** Load <repo root>/.env if present (no dotenv dependency). */
export function loadEnv(): void {
  try {
    process.loadEnvFile(p(".env"));
  } catch {
    // .env is optional
  }
}
