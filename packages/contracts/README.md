# @mcpify/contracts

Zod schemas and types for everything in `docs/01-CONTRACTS.md`.

```ts
import { ToolSchema, type Tool, mcpToolName, buildPreview, redactInputs, canonicalJson } from "@mcpify/contracts";

const tool: Tool = ToolSchema.parse(JSON.parse(raw));   // throws on invalid tools
mcpToolName(site, tool);                                // "scholarship__apply_scholarship"
buildPreview(tool, inputs);                             // [{ label, value }] with sensitive values masked
redactInputs(tool, inputs);                             // { otp: "•••", ... }
canonicalJson(receiptWithoutSignature);                 // sorted keys, for hashing/signing
```

Add `"@mcpify/contracts": "workspace:*"` to your package's dependencies.

Extra helpers beyond the contract doc: `stepParam(step)`, `sensitiveParams(tool)`, `MASK`.
An input-schema property can carry `"sensitive": true` and `"title"` (used as the preview label).
