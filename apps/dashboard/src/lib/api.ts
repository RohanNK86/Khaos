/** Typed client for the MCPify HTTP API (01-CONTRACTS §11). Every response is validated with the contract schemas. */
import {
  AuditEventSchema,
  ReceiptSchema,
  RecordingSchema,
  RepairProposalSchema,
  RunSchema,
  SiteSchema,
  ToolSchema,
  type AuditEvent,
  type Receipt,
  type Recording,
  type RepairProposal,
  type Run,
  type Site,
  type Tool,
} from "@mcpify/contracts";

export type RepairStatus = RepairProposal["status"];

export interface ContinueBody {
  approve?: boolean;
  value?: string;
}

/** The subset of the API the dashboard uses. Implemented by the HTTP client and the mock client. */
export interface ApiClient {
  health(): Promise<boolean>;
  listSites(): Promise<Site[]>;
  listTools(query?: { siteId?: string; status?: Tool["status"] }): Promise<Tool[]>;
  getTool(id: string): Promise<Tool>;
  getToolVersion(id: string, version: number): Promise<Tool>;
  approveTool(id: string): Promise<Tool>;
  disableTool(id: string): Promise<Tool>;
  getRecording(id: string): Promise<Recording>;
  listRuns(query?: { toolId?: string; limit?: number }): Promise<Run[]>;
  getRun(id: string): Promise<Run>;
  continueRun(id: string, body: ContinueBody): Promise<Run>;
  cancelRun(id: string): Promise<Run>;
  getReceipt(id: string): Promise<Receipt>;
  verifyReceipt(receipt: Receipt): Promise<{ valid: boolean }>;
  listAudit(query?: { siteId?: string; limit?: number }): Promise<AuditEvent[]>;
  listRepairs(status?: RepairStatus): Promise<RepairProposal[]>;
  approveRepair(id: string): Promise<{ proposal: RepairProposal; tool: Tool }>;
  rejectRepair(id: string): Promise<RepairProposal>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Turns an unknown JSON body into a typed value or throws. */
export type Parser<T> = (body: unknown) => T;

function objectWith(body: unknown, key: string): Record<string, unknown> {
  if (typeof body !== "object" || body === null || !(key in body)) throw new Error(`expected an object with "${key}"`);
  return body as Record<string, unknown>;
}
const parseBool =
  <K extends string>(key: K): Parser<Record<K, boolean>> =>
  (body) => {
    const v = objectWith(body, key)[key];
    if (typeof v !== "boolean") throw new Error(`"${key}" must be a boolean`);
    return { [key]: v } as Record<K, boolean>;
  };
const parseApprovedRepair: Parser<{ proposal: RepairProposal; tool: Tool }> = (body) => {
  const o = objectWith(body, "proposal");
  return { proposal: RepairProposalSchema.parse(o.proposal), tool: ToolSchema.parse(o.tool) };
};
const p =
  <T>(schema: { parse(v: unknown): T }): Parser<T> =>
  (v) =>
    schema.parse(v);

/** Builds `?a=1&b=2` from defined values only. */
export function queryString(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createHttpClient(baseUrl: string, fetchImpl: FetchLike = fetch): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");

  async function call<T>(parse: Parser<T>, method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, cache: "no-store" };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(`${base}${path}`, init);
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = json as { error?: string; details?: unknown } | undefined;
      throw new ApiError(err?.error ?? `${method} ${path} failed`, res.status, err?.details);
    }
    try {
      return parse(json);
    } catch (e) {
      throw new ApiError(`${method} ${path}: response does not match contract`, 502, e instanceof Error ? e.message : e);
    }
  }

  const enc = encodeURIComponent;
  return {
    health: async () => (await call(parseBool("ok"), "GET", "/health")).ok,
    listSites: () => call(p(SiteSchema.array()), "GET", "/sites"),
    listTools: (q = {}) => call(p(ToolSchema.array()), "GET", `/tools${queryString(q)}`),
    getTool: (id) => call(p(ToolSchema), "GET", `/tools/${enc(id)}`),
    getToolVersion: (id, v) => call(p(ToolSchema), "GET", `/tools/${enc(id)}/versions/${v}`),
    approveTool: (id) => call(p(ToolSchema), "POST", `/tools/${enc(id)}/approve`),
    disableTool: (id) => call(p(ToolSchema), "POST", `/tools/${enc(id)}/disable`),
    getRecording: (id) => call(p(RecordingSchema), "GET", `/recordings/${enc(id)}`),
    listRuns: (q = {}) => call(p(RunSchema.array()), "GET", `/runs${queryString(q)}`),
    getRun: (id) => call(p(RunSchema), "GET", `/runs/${enc(id)}`),
    continueRun: (id, body) => call(p(RunSchema), "POST", `/runs/${enc(id)}/continue`, body),
    cancelRun: (id) => call(p(RunSchema), "POST", `/runs/${enc(id)}/cancel`),
    getReceipt: (id) => call(p(ReceiptSchema), "GET", `/receipts/${enc(id)}`),
    verifyReceipt: (receipt) => call(parseBool("valid"), "POST", "/receipts/verify", receipt),
    listAudit: (q = {}) => call(p(AuditEventSchema.array()), "GET", `/audit${queryString(q)}`),
    listRepairs: (status) => call(p(RepairProposalSchema.array()), "GET", `/repairs${queryString({ status })}`),
    approveRepair: (id) => call(parseApprovedRepair, "POST", `/repairs/${enc(id)}/approve`),
    rejectRepair: (id) => call(p(RepairProposalSchema), "POST", `/repairs/${enc(id)}/reject`),
  };
}
