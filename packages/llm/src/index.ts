import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * The ONLY place that talks to Claude (CLAUDE.md §7). Claude Haiku 5.5 via Amazon Bedrock (Mantle) or the Claude API.
 * Every caller must have a non-LLM fallback: check llmAvailable() first.
 */
export type Provider = "bedrock" | "anthropic";

export const provider = (): Provider => (process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : "bedrock");

export const MODEL = (): string =>
  provider() === "anthropic"
    ? process.env.ANTHROPIC_MODEL_ID || "claude-haiku-5-5"
    : process.env.BEDROCK_MODEL_ID || "anthropic.claude-haiku-5-5";

/** Minimal client surface we use (lets tests inject a fake). */
export interface ClaudeLike {
  messages: Pick<Anthropic["messages"], "parse" | "create">;
}

let override: ClaudeLike | null = null;
let cached: ClaudeLike | null = null;

/** Tests: inject a fake client (pass null to reset). */
export function setClaudeForTests(c: ClaudeLike | null): void {
  override = c;
}

/** True when credentials for the configured provider are present (or a test client is injected). */
export function llmAvailable(): boolean {
  if (override) return true;
  if (process.env.LLM_DISABLED === "1") return false;
  if (provider() === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_BEARER_TOKEN_BEDROCK);
}

export function getClaude(): ClaudeLike {
  if (override) return override;
  cached ??= provider() === "anthropic" ? new Anthropic() : new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION });
  return cached;
}

export class LlmError extends Error {
  constructor(message: string, readonly reason: "unavailable" | "refusal" | "max_tokens" | "schema" | "api") {
    super(message);
  }
}

function logUsage(kind: string, usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  console.log(JSON.stringify({ llm: kind, model: MODEL(), input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0 }));
}

/** Structured output: returns data matching `schema`. Retries once on a schema failure. */
export async function parseJson<S extends z.ZodType>(
  schema: S,
  system: string,
  user: string,
  opts: { maxTokens?: number; effort?: "low" | "medium" | "high" } = {},
): Promise<z.infer<S>> {
  if (!llmAvailable()) throw new LlmError("no LLM credentials configured", "unavailable");
  const client = getClaude();
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let msg;
    try {
      msg = await client.messages.parse({
        model: MODEL(),
        max_tokens: opts.maxTokens ?? 16000,
        system,
        messages: [{ role: "user", content: attempt === 0 ? user : `${user}\n\n(Your previous answer did not match the schema: ${lastError}. Answer again.)` }],
        output_config: { format: zodOutputFormat(schema), effort: opts.effort ?? "medium" },
      });
    } catch (e) {
      throw new LlmError(`Claude request failed: ${(e as Error).message}`, "api");
    }
    logUsage("parseJson", msg.usage);
    if (msg.stop_reason === "refusal") throw new LlmError("Claude declined this request", "refusal");
    if (msg.stop_reason === "max_tokens") throw new LlmError("Claude's answer was cut off (max_tokens)", "max_tokens");
    if (msg.parsed_output != null) return msg.parsed_output as z.infer<S>;
    lastError = "no parsed output";
  }
  throw new LlmError(`Claude's answer did not match the schema: ${lastError}`, "schema");
}

/** Plain Messages call (used by the agent proxy). Caps max_tokens. */
export async function createMessage(params: Omit<Anthropic.MessageCreateParamsNonStreaming, "model">): Promise<Anthropic.Message> {
  if (!llmAvailable()) throw new LlmError("no LLM credentials configured", "unavailable");
  const msg = await getClaude().messages.create({ ...params, model: MODEL(), max_tokens: Math.min(params.max_tokens ?? 4000, 8000) });
  logUsage("createMessage", msg.usage);
  return msg;
}

/** Strip things that look like secrets or personal identifiers before text goes to the LLM. */
export function redactForLlm(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[aadhaar]")
    .replace(/(\+91[\s-]?)?\b[6-9]\d{9}\b/g, "[phone]")
    .replace(/\b\d{4,8}\b/g, "[number]");
}
