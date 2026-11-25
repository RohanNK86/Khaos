import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { configFromEnv, createApp } from "./server.js";
import { WIDGET_SCRIPT } from "./page.js";

let close: (() => void) | undefined;
afterEach(() => close?.());

async function serve(env: NodeJS.ProcessEnv) {
  const server = createApp(configFromEnv(env)).listen(0);
  await new Promise((r) => server.once("listening", r));
  close = () => server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("voice server", () => {
  it("config endpoint reports the agent id and no secrets", async () => {
    const base = await serve({ ELEVENLABS_AGENT_ID: "agent_abc123", ELEVENLABS_API_KEY: "sk_secret", PUBLIC_MCP_URL: "https://mcp.example/mcp" });
    const res = await fetch(`${base}/config.json`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      agentConfigured: true,
      agentId: "agent_abc123",
      portalUrl: "http://localhost:5101",
      liveUrl: "http://localhost:4100",
      mcpUrlConfigured: true,
    });
    expect(text).not.toContain("sk_secret");
  });

  it("reports a missing agent and shows setup steps instead of the widget", async () => {
    const base = await serve({});
    expect(await (await fetch(`${base}/config.json`)).json()).toMatchObject({ agentConfigured: false, agentId: null });
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("No agent configured");
    expect(html).not.toContain("<elevenlabs-convai");
  });

  it("embeds the widget with the agent id when configured", async () => {
    const base = await serve({ ELEVENLABS_AGENT_ID: "agent_abc123" });
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('<elevenlabs-convai agent-id="agent_abc123">');
    expect(html).toContain(WIDGET_SCRIPT);
    expect(html).toContain('src="http://localhost:5101"');
  });

  it("ignores agent ids that could inject markup", () => {
    expect(configFromEnv({ ELEVENLABS_AGENT_ID: '"><script>' }).agentId).toBe("");
  });
});

describe("agent-config.json", () => {
  it("has the Sahayak prompt with the confirmation rule and no secrets", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(new URL("../agent-config.json", import.meta.url), "utf8");
    const cfg = JSON.parse(raw) as { name: string; conversation_config: { agent: { prompt: { prompt: string } } } };
    expect(cfg.name).toBe("MCPify Sahayak");
    expect(cfg.conversation_config.agent.prompt.prompt).toContain("Shall I submit?");
    expect(raw).not.toMatch(/xi-api-key|sk_[a-z0-9]/i);
  });
});
