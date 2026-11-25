/** Server-only helpers shared by pages, route handlers and server actions. */
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ApiError } from "./api";
import type { Site, Tool } from "@mcpify/contracts";
import { getSource, type DataSource } from "./source";

/** Resolves the data source at request time (never during prerender). */
export async function requestSource(): Promise<DataSource> {
  await connection();
  return getSource();
}

export function publicApiUrl(): string {
  return process.env.PUBLIC_API_URL || process.env.API_URL || "http://localhost:4000";
}

export const MCP_LIVE_URL = process.env.MCP_LIVE_URL || "http://localhost:4100";

/** Maps for joining runs/repairs/audit rows to names. */
export async function lookups(source: DataSource): Promise<{ tools: Map<string, Tool>; sites: Map<string, Site> }> {
  const [tools, sites] = await Promise.all([source.client.listTools(), source.client.listSites()]);
  return { tools: new Map(tools.map((t) => [t.id, t])), sites: new Map(sites.map((s) => [s.id, s])) };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Awaits an API call and turns a 404 into Next's not-found page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}
