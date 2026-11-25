/** Messages between the side panel (engine) and the content script (DomDriver in the page). */

export const DRIVER_METHODS = [
  "url", "resolve", "fill", "select", "check", "click", "upload", "value", "text",
  "isVisible", "pageText", "hasErrorNear", "snapshot", "errors",
] as const;
export type DriverMethod = (typeof DRIVER_METHODS)[number];

export interface CallMessage {
  kind: "mcpify:call";
  method: DriverMethod;
  args: unknown[];
  /** Show the "DRY RUN" banner on the page while true. */
  banner: boolean;
}
export interface PingMessage { kind: "mcpify:ping" }
export interface BannerMessage { kind: "mcpify:banner"; on: boolean }
export type ContentMessage = CallMessage | PingMessage | BannerMessage;

export type Reply = { ok: true; value?: unknown } | { ok: false; error: string };

/** File bytes cross the message channel as base64 (messages are JSON). */
export interface WireFile { name: string; mime: string; base64: string }

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function isContentMessage(m: unknown): m is ContentMessage {
  if (!m || typeof m !== "object") return false;
  const k = (m as { kind?: unknown }).kind;
  if (k === "mcpify:ping") return true;
  if (k === "mcpify:banner") return typeof (m as BannerMessage).on === "boolean";
  if (k !== "mcpify:call") return false;
  const c = m as CallMessage;
  return (DRIVER_METHODS as readonly string[]).includes(c.method) && Array.isArray(c.args);
}
