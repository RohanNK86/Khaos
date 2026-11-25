/**
 * mcpify.js: the one script tag for site owners.
 *   <script src="https://api.example/static/mcpify.js" data-site="scholarship" defer></script>
 * Reads the approved tools for this origin from the API (the script's own origin), registers them
 * with WebMCP, and runs them in this page with the verified engine + DomDriver.
 */
import { installInPage } from "mcpify:in-page";
import { createMcpify } from "./boot.js";

const script = document.currentScript as HTMLScriptElement | null;
void createMcpify({
  win: window,
  apiBase: script?.src ? new URL(script.src).origin : "http://localhost:4000",
  site: script?.dataset.site,
  install: installInPage,
});
