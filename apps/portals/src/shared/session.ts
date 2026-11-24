import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_COOKIE = "ASP.NET_SessionId";

export type SessionData = Record<string, unknown>;

/** In-memory cookie sessions, like a classic legacy app. */
export class SessionStore {
  private sessions = new Map<string, SessionData>();

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const sid = readCookie(req.headers.cookie, SESSION_COOKIE);
      let id = sid && this.sessions.has(sid) ? sid : undefined;
      if (!id) {
        id = randomBytes(12).toString("hex");
        this.sessions.set(id, {});
        res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`);
      }
      res.locals.sid = id;
      res.locals.session = this.sessions.get(id);
      next();
    };
  }

  get(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  clear(): void {
    this.sessions.clear();
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
