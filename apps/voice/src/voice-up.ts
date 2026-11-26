/**
 * pnpm voice:up — one command for voice testing:
 *  1. opens a temporary public HTTPS tunnel to the local MCP server (:4100) with project-local cloudflared,
 *  2. registers that URL with ElevenLabs as a fresh MCP server (removes the previous MCPify one),
 *  3. creates the "MCPify Sahayak" agent the first time (saves ELEVENLABS_AGENT_ID in .env), else points it at the new server,
 *  4. keeps the tunnel open until Ctrl+C.
 * Nothing here spends voice characters; only talking to the agent does. Start `pnpm demo` first.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ElevenLabs } from "./elevenlabs.js";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const ENV = resolve(ROOT, ".env");
const SERVER_NAME = "MCPify (local tunnel)";

function setEnv(key: string, value: string) {
  const lines = readFileSync(ENV, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(ENV, lines.join("\n"));
}

async function waitForMcp() {
  for (let i = 0; i < 30; i++) {
    const ok = await fetch("http://localhost:4100/health").then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("MCP server is not running on :4100. Start it first with `pnpm demo` in another terminal.");
}

function openTunnel(): Promise<{ url: string; stop(): void }> {
  const bin = resolve(ROOT, "node_modules/.bin/cloudflared");
  const proc = spawn(bin, ["tunnel", "--url", "http://localhost:4100", "--http-host-header", "localhost:4100"], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("cloudflared did not print a URL within 30 s")), 30_000);
    const onData = (b: Buffer) => {
      const m = b.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        res({ url: m[0], stop: () => proc.kill("SIGINT") });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => rej(new Error(`cloudflared exited (${code})`)));
  });
}

async function waitPublic(url: string) {
  await new Promise((r) => setTimeout(r, 8000)); // let the new hostname reach DNS before the first lookup (avoids a cached "not found")
  for (let i = 0; i < 40; i++) {
    const ok = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("the tunnel URL did not become reachable");
}

async function main() {
  try { process.loadEnvFile(ENV); } catch { /* handled below */ }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is empty in .env");
  const el = new ElevenLabs(key);
  await waitForMcp();

  const tunnel = await openTunnel();
  process.on("exit", () => tunnel.stop());
  const mcpUrl = `${tunnel.url}/mcp`;
  console.log(`[voice] tunnel opened, waiting for it to be reachable…`);
  await waitPublic(tunnel.url);
  console.log(`[voice] public MCP URL (temporary): ${mcpUrl}`);

  const old = (await el.listMcpServers()).mcp_servers.filter((s) => s.config.name === SERVER_NAME);
  const server = await el.createMcpServer(mcpUrl, SERVER_NAME);
  console.log(`[voice] registered MCP server ${server.id} with ElevenLabs`);

  let agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) {
    const config = JSON.parse(readFileSync(resolve(ROOT, "apps/voice/agent-config.json"), "utf8").replace("REPLACE_WITH_MCP_SERVER_ID", server.id));
    agentId = (await el.createAgent(config)).agent_id;
    setEnv("ELEVENLABS_AGENT_ID", agentId);
    console.log(`[voice] created agent "MCPify Sahayak" ${agentId} (saved to .env)`);
  } else {
    await el.setAgentMcpServers(agentId, [server.id]);
    console.log(`[voice] agent ${agentId} now uses the new MCP server`);
  }
  setEnv("PUBLIC_MCP_URL", mcpUrl);
  for (const s of old) console.log(`[voice] old registration ${s.id}: ${(await el.deleteMcpServer(s.id)) ? "removed" : "left (remove it in the dashboard if you like)"}`);

  console.log("\n[voice] Ready. Open http://localhost:3100 (pnpm --filter @mcpify/voice dev) or the agent in the ElevenLabs dashboard and talk.");
  console.log("[voice] Talking uses your free ElevenLabs allowance: keep test calls short. Press Ctrl+C to close the tunnel.\n");
  process.on("SIGINT", () => { tunnel.stop(); console.log("[voice] tunnel closed"); process.exit(0); });
  await new Promise(() => undefined);
}

main().catch((e) => {
  const msg = (e as Error).message;
  console.error(`[voice] ${msg}`);
  if (msg.includes("convai_mcp_servers_disabled")) {
    console.error("[voice] MCP is switched off for your ElevenLabs workspace. In the ElevenLabs dashboard open Agents → Integrations (MCP servers),");
    console.error("[voice] read and accept the Model Context Protocol Server Terms, then run `pnpm voice:up` again. Nothing was created.");
  }
  process.exit(1);
});
