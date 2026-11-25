import { configFromEnv, createApp } from "./server.js";

const port = Number(process.env.VOICE_PORT || 3100);
const config = configFromEnv();
createApp(config).listen(port, () => {
  console.log(`MCPify voice page on http://localhost:${port}`);
  if (!config.agentId) console.log("ELEVENLABS_AGENT_ID is not set: the page shows setup steps instead of the widget.");
});
