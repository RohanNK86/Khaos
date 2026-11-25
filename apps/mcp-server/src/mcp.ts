import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { type Run, type Tool, type ToolCallResult } from "@mcpify/contracts";
import type { ApiClient } from "./api-client.js";
import type { Catalog } from "./catalog.js";

const SUFFIX =
  "\n\nMCPify verified tool: every step is checked before and after it runs, with no screenshots. " +
  "If the result status is awaiting_confirmation or awaiting_user_input, do what the result's message says and then call mcpify_continue. " +
  "Never invent values the user did not give you. Set mcpify_dry_run=true to fill everything but send nothing.";

const FIXED: McpTool[] = [
  {
    name: "mcpify_continue",
    description: "Answer a paused MCPify run. For awaiting_confirmation pass approve=true only after the user clearly agreed (approve=false cancels). For awaiting_user_input pass the value the user gave you (e.g. the OTP).",
    inputSchema: { type: "object", properties: { run_id: { type: "string" }, approve: { type: "boolean" }, value: { type: "string" } }, required: ["run_id"] },
  },
  {
    name: "mcpify_get_run",
    description: "Get the current status of an MCPify run.",
    inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "mcpify_cancel",
    description: "Cancel an MCPify run. Nothing further is sent.",
    inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"] },
  },
  {
    name: "mcpify_verify_receipt",
    description: "Verify the cryptographic signature of an MCPify receipt (proof of what was submitted).",
    inputSchema: { type: "object", properties: { receipt_id: { type: "string" } }, required: ["receipt_id"] },
    annotations: { readOnlyHint: true },
  },
];

/** Low-level MCP server: tools/list from the API catalog, every call proxied to the API run endpoints. */
export function buildMcpServer(catalog: Catalog, api: ApiClient): Server {
  const server = new Server({ name: "mcpify", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(await catalog.entries()).map(({ mcpName, tool, site }): McpTool => ({
        name: mcpName,
        title: `${tool.title} (${site.name})`,
        description: tool.description + (site.mode === "user_only" ? "\n\nThis is a third-party site: MCPify only runs it in dry-run mode." : "") + SUFFIX,
        inputSchema: withDryRun(tool),
        annotations: { readOnlyHint: !tool.steps.some((s) => s.risk === "commit"), openWorldHint: true },
      })),
      ...FIXED,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      return reply(await call(req.params.name, args));
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: (e as Error).message }) }] };
    }
  });

  const withTool = async (run: Run) => result(run, await catalog.toolOf(run.toolId, run.toolVersion).catch(() => undefined));

  async function call(name: string, args: Record<string, unknown>): Promise<ToolCallResult | Record<string, unknown>> {
    switch (name) {
      case "mcpify_continue":
        return withTool(await api.continueRun(String(args.run_id), {
          approve: typeof args.approve === "boolean" ? args.approve : undefined,
          value: args.value === undefined ? undefined : String(args.value),
        }));
      case "mcpify_get_run":
        return withTool(await api.getRun(String(args.run_id)));
      case "mcpify_cancel":
        return withTool(await api.cancelRun(String(args.run_id)));
      case "mcpify_verify_receipt": {
        const receipt = await api.getReceipt(String(args.receipt_id));
        const valid = await api.verifyReceipt(receipt);
        return { receipt_id: receipt.id, valid, key_id: receipt.keyId, issued_at: receipt.issuedAt, outputs: receipt.outputs, summary: receipt.summary,
          message: valid ? "Signature is valid: this receipt was issued by MCPify and has not been changed." : "Signature is NOT valid." };
      }
    }
    const entry = await catalog.find(name);
    if (!entry) throw new Error(`unknown tool ${name}`);
    const { mcpify_dry_run, ...inputs } = args;
    // the API validates and coerces inputs ("Please fix the inputs: ...") and forces dry runs on user_only sites
    const dryRun = mcpify_dry_run === true || entry.site.mode === "user_only";
    return result(await api.startRun({ toolId: entry.tool.id, inputs, mode: "owner", dryRun }), entry.tool);
  }

  return server;
}

function withDryRun(tool: Tool) {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> } & Record<string, unknown>;
  return {
    ...schema,
    type: "object" as const,
    properties: { ...(schema.properties ?? {}), mcpify_dry_run: { type: "boolean", default: false, description: "Fill everything but stop before anything is sent." } },
  };
}

const reply = (r: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] });

/** Turn a run into the ToolCallResult the agent sees (01-CONTRACTS §12). */
export function result(run: Run, tool?: Tool): ToolCallResult {
  const intent = (id?: string) => tool?.steps.find((s) => s.id === id)?.intent ?? id ?? "";
  const base = { run_id: run.id, status: run.status };
  switch (run.status) {
    case "awaiting_confirmation":
      return { ...base, need: run.need, message:
        `Ready to: ${intent(run.need?.stepId)}. Read these details to the user and ask "Shall I go ahead?". ` +
        `Only if they clearly say yes, call mcpify_continue with approve=true; otherwise call it with approve=false.` };
    case "awaiting_user_input":
      return { ...base, need: run.need, message:
        `${run.need?.kind === "user_input" ? run.need.prompt : ""} Ask the user for it and call mcpify_continue with value=<what they said>. Never guess it.` };
    case "succeeded":
      return { ...base, outputs: run.outputs, receipt_id: run.receiptId, message:
        `Done. ${Object.entries(run.outputs).map(([k, v]) => `${k}: ${v}`).join(", ")}.` + (run.receiptId ? ` A signed receipt was issued (receipt_id ${run.receiptId}).` : "") };
    case "failed": {
      const err = run.trace.find((t) => t.status === "failed")?.error;
      return { ...base, error: err, message: `Stopped safely at the step "${intent(run.failedStepId)}". Nothing after this step was sent. Reason: ${err ?? "unknown"}` };
    }
    case "dry_run_complete": {
      const blocked = run.trace.find((t) => t.status === "blocked_dry_run");
      const filled = run.trace.filter((t) => t.status === "passed").length;
      return { ...base, outputs: run.outputs, message: `Dry run finished: ${filled} steps done and verified, then stopped before "${intent(blocked?.stepId)}". Nothing was sent.` };
    }
    case "stopped":
      return { ...base, message: "The run was cancelled. Nothing further was sent." };
    default:
      return { ...base, message: "Still running. Call mcpify_get_run in a few seconds." };
  }
}
