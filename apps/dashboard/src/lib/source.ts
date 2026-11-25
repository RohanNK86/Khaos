/** Picks the data source: the real API, or mock data when forced (NEXT_PUBLIC_MOCK=1) or when the API is unreachable. */
import { createMockClient } from "../mock/client";
import { createHttpClient, type ApiClient, type FetchLike } from "./api";

export interface DataSource {
  client: ApiClient;
  mock: boolean;
  /** Why mock data is shown, for the badge tooltip. */
  reason?: string;
}

export interface SourceEnv {
  NEXT_PUBLIC_MOCK?: string;
  /** Runtime switch; NEXT_PUBLIC_* values are inlined when `next build` runs. */
  MCPIFY_MOCK?: string;
  API_URL?: string;
}

export const DEFAULT_API_URL = "http://localhost:4000";

export function isMockForced(env: SourceEnv): boolean {
  const on = (v?: string) => ["1", "true", "yes"].includes((v ?? "").toLowerCase());
  return on(env.NEXT_PUBLIC_MOCK) || on(env.MCPIFY_MOCK);
}

export function apiUrl(env: SourceEnv): string {
  return env.API_URL || DEFAULT_API_URL;
}

/** Health probe with a short timeout so an absent API never stalls a page. */
export async function probe(baseUrl: string, fetchImpl: FetchLike = fetch, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * One mock client per server process so approvals made in the UI persist between page loads.
 * Kept on globalThis because Next bundles pages and route handlers separately (separate module instances).
 */
const holder = globalThis as typeof globalThis & { __mcpifyMockClient?: ApiClient };
function mockClient(): ApiClient {
  holder.__mcpifyMockClient ??= createMockClient();
  return holder.__mcpifyMockClient;
}

export async function resolveSource(env: SourceEnv, fetchImpl: FetchLike = fetch): Promise<DataSource> {
  if (isMockForced(env)) return { client: mockClient(), mock: true, reason: "NEXT_PUBLIC_MOCK=1" };
  const base = apiUrl(env);
  if (await probe(base, fetchImpl)) return { client: createHttpClient(base, fetchImpl), mock: false };
  return { client: mockClient(), mock: true, reason: `API not reachable at ${base}` };
}

/** Server-side entry point used by pages, route handlers and server actions. */
export function getSource(): Promise<DataSource> {
  return resolveSource({
    NEXT_PUBLIC_MOCK: process.env.NEXT_PUBLIC_MOCK,
    MCPIFY_MOCK: process.env.MCPIFY_MOCK,
    API_URL: process.env.API_URL,
  });
}
