/** Voice demo page: ElevenLabs agent widget next to the portal and the live run view. */
import express, { type Express } from "express";
import { renderPage } from "./page.js";

export interface VoiceConfig {
  agentId: string;
  portalUrl: string;
  liveUrl: string;
  mcpUrl: string;
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Reads settings from env. Only public values: never an API key. Invalid agent ids are ignored. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const agentId = (env.ELEVENLABS_AGENT_ID ?? "").trim();
  return {
    agentId: AGENT_ID.test(agentId) ? agentId : "",
    portalUrl: env.PORTAL_URL || "http://localhost:5101",
    liveUrl: env.MCP_LIVE_URL || "http://localhost:4100",
    mcpUrl: env.PUBLIC_MCP_URL || "",
  };
}

export function createApp(config: VoiceConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/", (_req, res) => {
    res.type("html").send(renderPage(config));
  });
  app.get("/config.json", (_req, res) => {
    res.json({
      agentConfigured: config.agentId !== "",
      agentId: config.agentId || null,
      portalUrl: config.portalUrl,
      liveUrl: config.liveUrl,
      mcpUrlConfigured: config.mcpUrl !== "",
    });
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
