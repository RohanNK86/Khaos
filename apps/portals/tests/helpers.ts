import type { Server } from "node:http";
import type { Express } from "express";
import type { BrowserContext } from "playwright";

export const TOKEN = { "x-lab-token": "changeme" };
export const FILES = new URL("../../../fixtures/files/", import.meta.url);
export const TOOLS = new URL("../../../fixtures/tools/", import.meta.url);

/** Start a portal on a random port. */
export function listen(app: Express): { server: Server; base: string } {
  const server = app.listen(0);
  const a = server.address();
  return { server, base: `http://localhost:${typeof a === "object" && a ? a.port : 0}` };
}

export async function lab<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...TOKEN, "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  return (await (await fetch(`${base}/__lab/${path}`, { ...init, headers })).json()) as T;
}

/** The OTP the portal sent for this browser context's session. */
export async function otpOf(base: string, ctx: BrowserContext): Promise<string> {
  const sid = (await ctx.cookies()).find((c) => c.name === "ASP.NET_SessionId")!.value;
  return (await lab<{ otp: string }>(base, `otp?session=${sid}`)).otp;
}
