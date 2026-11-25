/** Shapes returned by the dashboard's own /api/runs route handlers (polled by the Runs pages). */
import type { Run, Tool } from "@mcpify/contracts";
import type { ApiClient } from "./api";

export interface RunRow extends Run {
  toolName: string;
  toolTitle: string;
}

export interface RunDetail {
  run: Run;
  tool: Tool | null;
}

export async function listRunRows(client: ApiClient, limit = 50): Promise<RunRow[]> {
  const [runs, tools] = await Promise.all([client.listRuns({ limit }), client.listTools()]);
  const byId = new Map(tools.map((t) => [t.id, t]));
  return runs.map((r) => ({ ...r, toolName: byId.get(r.toolId)?.name ?? r.toolId, toolTitle: byId.get(r.toolId)?.title ?? r.toolId }));
}

export async function getRunDetail(client: ApiClient, id: string): Promise<RunDetail> {
  const run = await client.getRun(id);
  const tool = await client
    .getToolVersion(run.toolId, run.toolVersion)
    .catch(() => client.getTool(run.toolId))
    .catch(() => null);
  return { run, tool };
}
