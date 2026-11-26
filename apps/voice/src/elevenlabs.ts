/** Minimal ElevenLabs Agents API client (endpoints per the API reference, checked 26 Nov 2026). */
const BASE = process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io";

export class ElevenLabs {
  constructor(private key: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "xi-api-key": this.key, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ElevenLabs ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Register our MCP server (streamable HTTP). MCPify itself pauses for confirmation before anything is sent. */
  createMcpServer(url: string, name: string) {
    return this.req<{ id: string }>("POST", "/v1/convai/mcp-servers", {
      config: {
        url, name, transport: "STREAMABLE_HTTP", approval_policy: "auto_approve_all",
        description: "MCPify verified tools for the DEMO portals (confirmation and OTP pauses are enforced by MCPify).",
      },
    });
  }

  listMcpServers() {
    return this.req<{ mcp_servers: { id: string; config: { name: string; url: string } }[] }>("GET", "/v1/convai/mcp-servers");
  }

  /** Best effort: remove an old tunnel registration (ignored if the API refuses). */
  async deleteMcpServer(id: string): Promise<boolean> {
    try {
      await this.req("DELETE", `/v1/convai/mcp-servers/${encodeURIComponent(id)}`);
      return true;
    } catch {
      return false;
    }
  }

  createAgent(config: Record<string, unknown>) {
    return this.req<{ agent_id: string }>("POST", "/v1/convai/agents/create", config);
  }

  setAgentMcpServers(agentId: string, ids: string[]) {
    return this.req("PATCH", `/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      conversation_config: { agent: { prompt: { mcp_server_ids: ids } } },
    });
  }
}
