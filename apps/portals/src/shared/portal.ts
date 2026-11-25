import type { Request, Response } from "express";
import { attrs, esc } from "./html.js";
import type { SessionData } from "./session.js";

/** Per-request view of a demo portal: session, session id and owner mode. */
export interface PortalCtx { s: SessionData; sid: string; owner: boolean }

/** Owner mode: `?owner=1` (sticky per session) or env OWNER_MODE=1. */
export function portalCtx(req: Request, res: Response): PortalCtx {
  const s = res.locals.session as SessionData;
  if (req.query.owner === "1") s.owner = true;
  if (req.query.owner === "0") s.owner = false;
  return { s, sid: res.locals.sid as string, owner: process.env.OWNER_MODE === "1" || s.owner === true };
}

/** `data-mcpify` value in owner mode, nothing otherwise. */
export const mc = (c: PortalCtx, key: string) => (c.owner ? key : undefined);

/** The official MCPify script tag, only in owner mode. */
export const ownerScript = (c: PortalCtx, apiUrl: string, slug: string) =>
  c.owner ? `<script src="${esc(apiUrl)}/static/mcpify.js" data-site="${esc(slug)}" defer></script>` : "";

export const apiUrlOf = (opt?: string) => opt ?? process.env.API_URL ?? "http://localhost:4000";

/** A legacy form row: table-cell label + `<label for>` + control + optional error span. */
export function formRow(label: string, id: string, control: string, err?: string): string {
  const e = err ? `<span class="error" id="${esc(id)}_err">${esc(err)}</span>` : "";
  return `<tr><td class="lbl"><label for="${esc(id)}">${esc(label)}</label> <span class="req">*</span></td><td>${control}${e}</td></tr>`;
}

/** An `<input>` with id, name and owner-mode data-mcpify. */
export function input(c: PortalCtx, a: { id: string; name: string; key: string; type?: string; value?: string; extra?: Record<string, string | number | boolean | undefined> }): string {
  return `<input ${attrs({ type: a.type ?? "text", id: a.id, name: a.name, value: a.value, "data-mcpify": mc(c, a.key), ...a.extra })}/>`;
}

/** A submit button with id, name and owner-mode data-mcpify. */
export function submit(c: PortalCtx, id: string, key: string, text: string): string {
  return `<input type="submit" class="btn" ${attrs({ id, name: id, value: text, "data-mcpify": mc(c, key) })}/>`;
}
