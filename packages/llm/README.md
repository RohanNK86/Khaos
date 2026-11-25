# @mcpify/llm

The only place that calls Claude (Claude Haiku 5.5). `LLM_PROVIDER=bedrock` (default; Mantle client, `AWS_REGION`, `BEDROCK_MODEL_ID`) or `anthropic` (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_ID`).

```ts
import { llmAvailable, parseJson, redactForLlm } from "@mcpify/llm";
if (llmAvailable()) {
  const out = await parseJson(MyZodSchema, systemPrompt, redactForLlm(userText));
}
```
- Every caller needs a rules-only fallback when `llmAvailable()` is false (no keys yet).
- `parseJson` uses structured outputs (`messages.parse` + `zodOutputFormat`), retries once, throws `LlmError` with `reason` `unavailable | refusal | max_tokens | schema | api`.
- `createMessage(params)` for the agent proxy (max_tokens capped at 8000). Token usage is logged as JSON lines.
- Tests: `setClaudeForTests(fake)`; live test with `LIVE_LLM=1`.
