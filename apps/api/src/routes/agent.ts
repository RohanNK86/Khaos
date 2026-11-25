import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LlmError, createMessage, llmAvailable } from "@mcpify/llm";
import { HttpError, parse } from "../http.js";

const MAX_TOKENS = 4000;
const PER_MINUTE = 30;

const AgentStepBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]) }))
    .min(1),
  tools: z.array(z.record(z.string(), z.unknown())).default([]),
  system: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(),
  max_tokens: z.number().int().min(1).optional(),
});

type MessageParams = Parameters<typeof createMessage>[0];

/** Fixed-window-ish limiter: at most `limit` hits per key in the last minute (in memory). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit = PER_MINUTE, private windowMs = 60_000) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** POST /agent/step: thin Claude proxy so browser clients never hold keys (S8). */
export function agentRoutes(app: FastifyInstance, limiter = new RateLimiter()): void {
  app.post("/agent/step", async (req) => {
    if (!limiter.allow(req.ip)) throw new HttpError(429, `rate limit: at most ${PER_MINUTE} agent steps per minute`);
    const body = parse(AgentStepBody, req.body);
    if (!llmAvailable()) throw new HttpError(503, "the agent proxy is not configured: no LLM credentials on the server (set LLM_PROVIDER and its keys in .env)");
    // The body was validated structurally above; the Anthropic SDK types are richer than what we check.
    const { tools, ...rest } = body;
    const params = { ...rest, ...(tools.length ? { tools } : {}), max_tokens: Math.min(body.max_tokens ?? MAX_TOKENS, MAX_TOKENS) } as unknown as MessageParams;
    try {
      return await createMessage(params);
    } catch (e) {
      if (e instanceof LlmError && e.reason === "unavailable") throw new HttpError(503, e.message);
      throw new HttpError(502, `Claude request failed: ${(e as Error).message}`);
    }
  });
}
