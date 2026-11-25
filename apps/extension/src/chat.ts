/**
 * Optional chat mode: the panel sends the conversation and the site's tools to POST /agent/step
 * (a thin proxy to the Claude Messages API; keys never live in the extension), runs every tool_use
 * locally with the engine, and returns tool_results until the model stops asking for tools.
 * OTPs/CAPTCHAs are typed by the human in the panel and never reach the model.
 */
import type { Tool } from "@mcpify/contracts";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage { role: "user" | "assistant"; content: string | Block[] }

export class ChatUnavailable extends Error {}

export interface ChatDeps {
  apiBase: string;
  tools: Tool[];
  /** Runs a tool in the tab (with all the usual pauses) and returns a JSON result for the model. */
  execute(tool: Tool, input: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  onAssistantText(text: string): void;
  fetch?: typeof fetch;
}

const MAX_STEPS = 8;

export const anthropicTools = (tools: Tool[]) =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

function parseMessage(body: unknown): { content: Block[]; stop_reason?: string } {
  const b = body as { content?: unknown; stop_reason?: unknown };
  if (!b || !Array.isArray(b.content)) throw new Error("unexpected reply from /agent/step");
  const content = b.content.filter((x): x is Block => !!x && typeof x === "object" && (x.type === "text" || x.type === "tool_use"));
  return { content, stop_reason: typeof b.stop_reason === "string" ? b.stop_reason : undefined };
}

/** Send one user message and drive the tool loop. Returns the updated history. */
export async function chatTurn(history: ChatMessage[], userText: string, d: ChatDeps): Promise<ChatMessage[]> {
  const f = d.fetch ?? fetch;
  const messages: ChatMessage[] = [...history, { role: "user", content: userText }];
  for (let i = 0; i < MAX_STEPS; i++) {
    const r = await f(`${d.apiBase}/agent/step`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, tools: anthropicTools(d.tools) }),
    });
    if (r.status === 503 || r.status === 501) throw new ChatUnavailable("Chat is not available: the MCPify API has no model configured.");
    if (!r.ok) throw new Error(`/agent/step failed (${r.status})`);
    const msg = parseMessage(await r.json());
    messages.push({ role: "assistant", content: msg.content });
    for (const b of msg.content) if (b.type === "text" && b.text.trim()) d.onAssistantText(b.text);
    const uses = msg.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || uses.length === 0) return messages;
    const results: Block[] = [];
    for (const u of uses) {
      const tool = d.tools.find((t) => t.name === u.name || u.name.endsWith(`__${t.name}`));
      const out = tool ? await d.execute(tool, u.input) : { text: `unknown tool ${u.name}`, isError: true };
      results.push({ type: "tool_result", tool_use_id: u.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return messages;
}
