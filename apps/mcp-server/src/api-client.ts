import { ReceiptSchema, RunSchema, SiteSchema, ToolSchema, type Receipt, type Run, type Site, type Tool } from "@mcpify/contracts";
import { z } from "zod";

export interface BlockedRequest {
  method: string;
  url: string;
  at: string;
}

/** Error from the MCPify API (its `{ error }` message is meant for people). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Typed client for apps/api (01-CONTRACTS §11). Every response is validated with the contract schemas. */
export class ApiClient {
  constructor(readonly baseUrl = process.env.API_URL ?? "http://localhost:4000") {}

  sites = () => this.req("GET", "/sites", z.array(SiteSchema));
  approvedTools = () => this.req("GET", "/tools?status=approved", z.array(ToolSchema));
  toolVersion = (id: string, v: number) => this.req("GET", `/tools/${enc(id)}/versions/${v}`, ToolSchema);
  createTool = (draft: Record<string, unknown>) => this.req("POST", "/tools", ToolSchema, draft);
  approveTool = (id: string) => this.req("POST", `/tools/${enc(id)}/approve`, ToolSchema);

  startRun = (body: { toolId: string; inputs: Record<string, unknown>; mode: "owner"; dryRun: boolean }) => this.req("POST", "/runs", RunSchema, body);
  continueRun = (id: string, answer: { approve?: boolean; value?: string }) => this.req("POST", `/runs/${enc(id)}/continue`, RunSchema, answer);
  cancelRun = (id: string) => this.req("POST", `/runs/${enc(id)}/cancel`, RunSchema, {});
  getRun = (id: string) => this.req("GET", `/runs/${enc(id)}`, RunSchema);
  listRuns = (limit = 20) => this.req("GET", `/runs?limit=${limit}`, z.array(RunSchema));
  blocked = (id: string): Promise<BlockedRequest[]> =>
    this.req("GET", `/runs/${enc(id)}/blocked`, z.array(z.object({ method: z.string(), url: z.string(), at: z.string() })));

  getReceipt = (id: string): Promise<Receipt> => this.req("GET", `/receipts/${enc(id)}`, ReceiptSchema);
  verifyReceipt = async (r: Receipt): Promise<boolean> => (await this.req("POST", "/receipts/verify", z.object({ valid: z.boolean() }), r)).valid;

  private async req<S extends z.ZodType>(method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(503, `MCPify API is not reachable at ${this.baseUrl} (${(e as Error).message}). Start it with pnpm --filter @mcpify/api dev`);
    }
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `API ${method} ${path} failed with ${res.status}`);
    return schema.parse(data);
  }
}

const enc = encodeURIComponent;

export type { Run, Site, Tool };
