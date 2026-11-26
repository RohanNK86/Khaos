import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { LlmError, MODEL, llmAvailable, parseJson, redactForLlm, setClaudeForTests, type ClaudeLike } from "../src/index.js";

afterEach(() => setClaudeForTests(null));

const fake = (replies: unknown[]): ClaudeLike & { calls: unknown[] } => {
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      parse: (async (p: unknown) => { calls.push(p); return replies.shift(); }) as never,
      create: (async () => replies.shift()) as never,
    },
  };
};

test("parseJson returns parsed output and uses structured outputs", async () => {
  const c = fake([{ stop_reason: "end_turn", parsed_output: { name: "income" }, usage: { input_tokens: 10, output_tokens: 3 } }]);
  setClaudeForTests(c);
  const out = await parseJson(z.object({ name: z.string() }), "sys", "user");
  expect(out).toEqual({ name: "income" });
  const p = c.calls[0] as { model: string; output_config: { effort: string; format: unknown } };
  expect(p.model).toBe(MODEL());
  expect(p.output_config.effort).toBe("low");
  expect(p.output_config.format).toBeDefined();
});

test("parseJson retries once when nothing parsed, then fails with a typed error", async () => {
  setClaudeForTests(fake([{ stop_reason: "end_turn", parsed_output: null }, { stop_reason: "end_turn", parsed_output: null }]));
  await expect(parseJson(z.object({}), "s", "u")).rejects.toMatchObject({ reason: "schema" });
});

test("refusal and max_tokens are typed errors", async () => {
  setClaudeForTests(fake([{ stop_reason: "refusal", parsed_output: null }]));
  await expect(parseJson(z.object({}), "s", "u")).rejects.toBeInstanceOf(LlmError);
  setClaudeForTests(fake([{ stop_reason: "max_tokens", parsed_output: null }]));
  await expect(parseJson(z.object({}), "s", "u")).rejects.toMatchObject({ reason: "max_tokens" });
});

test("without credentials the LLM is unavailable", async () => {
  const saved = { ...process.env };
  delete process.env.ANTHROPIC_API_KEY; delete process.env.AWS_ACCESS_KEY_ID; delete process.env.AWS_PROFILE; delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  expect(llmAvailable()).toBe(false);
  await expect(parseJson(z.object({}), "s", "u")).rejects.toMatchObject({ reason: "unavailable" });
  process.env = saved;
});

test("redactForLlm strips emails, phones, aadhaar-like and OTP-like numbers", () => {
  expect(redactForLlm("asha@example.com 9876543210 1234 5678 9012 OTP 482913")).toBe("[email] [phone] [aadhaar] OTP [number]");
});

test.skipIf(process.env.LIVE_LLM !== "1")("live: Claude Haiku 5.5 returns structured JSON", async () => {
  const out = await parseJson(z.object({ snake: z.string() }), "Convert the label to a snake_case parameter name.", "Annual family income");
  expect(out.snake).toMatch(/income/);
});
