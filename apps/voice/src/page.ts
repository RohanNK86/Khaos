import type { VoiceConfig } from "./server.js";

/** ElevenLabs Agents widget embed, as documented at elevenlabs.io/docs/agents-platform/customization/widget. */
export const WIDGET_SCRIPT = "https://unpkg.com/@elevenlabs/convai-widget-embed";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function widget(agentId: string): string {
  return `<div class="ready"><span class="dot"></span> Agent connected: <code>${esc(agentId)}</code></div>
<p class="hint">Press the call button (bottom right) and speak in Kannada, Hindi or English, for example:</p>
<ul class="say">
  <li>“ನನಗೆ ವಿದ್ಯಾರ್ಥಿ ವೇತನಕ್ಕೆ ಅರ್ಜಿ ಹಾಕಬೇಕು.”</li>
  <li>“मुझे स्कॉलरशिप के लिए आवेदन करना है।”</li>
  <li>“Check the status of application SSP-2026-000123.”</li>
</ul>
<elevenlabs-convai agent-id="${esc(agentId)}"></elevenlabs-convai>
<script src="${WIDGET_SCRIPT}" async type="text/javascript"></script>`;
}

function setup(): string {
  return `<div class="warn"><b>No agent configured.</b> Set <code>ELEVENLABS_AGENT_ID</code> in the root <code>.env</code> and restart.</div>
<ol class="steps">
  <li>Create the agent <b>MCPify Sahayak</b> in ElevenLabs (prompt and settings: <code>apps/voice/README.md</code>, or <code>agent-config.json</code> via the API).</li>
  <li>Expose the MCP server over HTTPS and set <code>PUBLIC_MCP_URL</code> (for example a <code>cloudflared</code> tunnel to <code>http://localhost:4100/mcp</code>).</li>
  <li>Add it as a custom MCP server on the agent; tool approval: fine-grained.</li>
  <li>Disable agent authentication (Advanced tab) so the widget can connect; allowlist <code>localhost:3100</code> (Security tab).</li>
  <li>Copy the agent id into <code>ELEVENLABS_AGENT_ID</code> and run <code>pnpm --filter @mcpify/voice dev</code>.</li>
</ol>`;
}

export function renderPage(c: VoiceConfig): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCPify · Sahayak voice</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--cream:#F8F2E4;--ink:#1A1A1A;--orange:#FD9B36;--accent:#E8590C}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--cream);color:var(--ink);font-family:"Space Grotesk",system-ui,sans-serif;font-size:17px;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:14px;padding:14px 24px;border-bottom:3px solid var(--ink)}
h1{font-family:"Archivo Black","Arial Black",system-ui;font-size:28px;margin:0}h1 span{color:var(--accent)}
h2{font-family:"Archivo Black","Arial Black",system-ui;font-size:20px;margin:0 0 10px}
.tag{border:2px solid var(--ink);padding:2px 10px;font-weight:700;background:#fff;box-shadow:3px 3px 0 var(--ink)}
main{flex:1;display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:20px;padding:20px 24px;min-height:0}
.card{background:#fff;border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:16px}
.side{display:flex;flex-direction:column;gap:20px;overflow:auto}
.frames{display:grid;grid-template-rows:3fr 2fr;gap:20px;min-height:0}
.frame{display:flex;flex-direction:column;padding:0;min-height:0}
.frame .bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:3px solid var(--ink);background:var(--orange);font-weight:700}
.frame .bar a{color:var(--ink)}
iframe{flex:1;width:100%;border:0;background:#fff;min-height:240px}
code{background:#f1ece0;padding:0 4px}
.ready{font-weight:700;background:#9be59b;border:2px solid var(--ink);padding:8px 10px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#11772b;margin-right:4px}
.warn{background:#ffe08a;border:2px solid var(--ink);padding:10px}
.steps li,.flow li{margin:6px 0}.say li{margin:6px 0;font-weight:600}
.hint{margin:12px 0 4px}
@media (max-width:900px){main{grid-template-columns:1fr}.frames{grid-template-rows:auto auto}iframe{height:60vh}}
</style></head><body>
<header><h1>MCP<span>ify</span></h1><span class="tag">Sahayak · voice agent</span><span class="tag" style="background:var(--orange)">DEMO portals only</span></header>
<main>
  <div class="side">
    <section class="card"><h2>Talk to Sahayak</h2>${c.agentId ? widget(c.agentId) : setup()}</section>
    <section class="card"><h2>What happens</h2>
      <ol class="flow">
        <li>Sahayak calls the verified tool on our MCP server.</li>
        <li>Before anything is sent, it reads the preview back: <b>“Shall I submit?”</b></li>
        <li>You say the OTP; it is passed through, never stored.</li>
        <li>It reads out the Application ID and the signed receipt id.</li>
      </ol>
    </section>
  </div>
  <div class="frames">
    <section class="card frame"><div class="bar">Portal <a href="${esc(c.portalUrl)}" target="_blank" rel="noreferrer">open ↗</a></div>
      <iframe src="${esc(c.portalUrl)}" title="Demo portal"></iframe></section>
    <section class="card frame"><div class="bar">Live verified run <a href="${esc(c.liveUrl)}" target="_blank" rel="noreferrer">open ↗</a></div>
      <iframe src="${esc(c.liveUrl)}" title="Live run view"></iframe></section>
  </div>
</main>
</body></html>`;
}
