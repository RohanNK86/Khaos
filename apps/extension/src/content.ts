/**
 * Content script: hosts a DomDriver for the page and executes one driver call per message.
 * The engine itself runs in the side panel, so page reloads only cost a re-injection.
 */
import { createDomDriver } from "@mcpify/engine/dom";
import { installInPage } from "mcpify:in-page";
import { fromBase64, isContentMessage, type CallMessage, type Reply, type WireFile } from "./protocol.js";

const BANNER_ID = "mcpify-dry-run-banner";
const flag = globalThis as { __mcpifyContent?: boolean };

function setBanner(on: boolean) {
  const existing = document.getElementById(BANNER_ID);
  if (!on) return existing?.remove();
  if (existing) return;
  const b = document.createElement("div");
  b.id = BANNER_ID;
  b.textContent = "DRY RUN: nothing will be sent";
  b.setAttribute("style", [
    "position:fixed", "top:0", "left:50%", "transform:translateX(-50%)", "z-index:2147483647",
    "background:#FD9B36", "color:#1A1A1A", "border:3px solid #1A1A1A", "border-top:0", "box-shadow:4px 4px 0 #1A1A1A",
    "padding:6px 16px", "font:800 14px system-ui,sans-serif", "letter-spacing:.04em", "border-radius:0 0 8px 8px",
  ].join(";"));
  document.documentElement.appendChild(b);
}

async function call(driver: ReturnType<typeof createDomDriver>, m: CallMessage): Promise<unknown> {
  setBanner(m.banner);
  if (m.method === "upload") {
    const f = m.args[1] as WireFile;
    return driver.upload(m.args[0], { name: f.name, mime: f.mime, bytes: fromBase64(f.base64) });
  }
  const fn = driver[m.method] as (...a: unknown[]) => Promise<unknown>;
  return fn.apply(driver, m.args);
}

if (!flag.__mcpifyContent) {
  flag.__mcpifyContent = true;
  const driver = createDomDriver(document, { install: installInPage, highlight: true, actionDelayMs: 200 });
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (r: Reply) => void) => {
    if (!isContentMessage(msg)) return false;
    if (msg.kind === "mcpify:ping") { sendResponse({ ok: true, value: "pong" }); return false; }
    if (msg.kind === "mcpify:banner") { setBanner(msg.on); sendResponse({ ok: true }); return false; }
    call(driver, msg).then(
      (value) => sendResponse({ ok: true, value }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true; // async response
  });
}
