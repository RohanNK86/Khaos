import { z } from "zod";

// ── 1. Core enums ────────────────────────────────────────────────────────────
export const RiskClassSchema = z.enum(["read", "fill", "commit", "auth"]);
export const RepairPolicySchema = z.enum(["auto", "human"]);
export const ToolStatusSchema = z.enum(["draft", "approved", "disabled"]);
export const RunModeSchema = z.enum(["owner", "user"]);
export const RunStatusSchema = z.enum([
  "running",
  "awaiting_confirmation",
  "awaiting_user_input",
  "succeeded",
  "failed",
  "repair_pending",
  "stopped",
  "dry_run_complete",
]);

// ── 2. Locators ──────────────────────────────────────────────────────────────
export const LocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("testid"), value: z.string().min(1) }),
  z.object({ kind: z.literal("id"), value: z.string().min(1) }),
  z.object({ kind: z.literal("name"), value: z.string().min(1) }),
  z.object({ kind: z.literal("label"), value: z.string().min(1) }),
  z.object({ kind: z.literal("role"), role: z.string().min(1), name: z.string() }),
  z.object({ kind: z.literal("text"), value: z.string().min(1) }),
  z.object({ kind: z.literal("css"), value: z.string().min(1) }),
  z.object({ kind: z.literal("near"), anchorText: z.string().min(1), tag: z.string().min(1) }),
  z.object({ kind: z.literal("xpath"), value: z.string().min(1) }),
]);

// ── 3. Conditions ────────────────────────────────────────────────────────────
const locs = z.array(LocatorSchema).min(1);
export const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible"), locators: locs }),
  z.object({ kind: z.literal("hidden"), locators: locs }),
  z.object({ kind: z.literal("valueEquals"), locators: locs, param: z.string() }),
  z.object({ kind: z.literal("textPresent"), text: z.string() }),
  z.object({ kind: z.literal("textAbsent"), text: z.string() }),
  z.object({ kind: z.literal("urlMatches"), pattern: z.string() }),
  z.object({ kind: z.literal("noErrorNear"), locators: locs }),
  z.object({
    kind: z.literal("extract"),
    locators: locs,
    as: z.string(),
    pattern: z.string().optional(),
  }),
]);

// ── 4. Actions ───────────────────────────────────────────────────────────────
export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string() }),
  z.object({ type: z.literal("fill"), param: z.string() }),
  z.object({ type: z.literal("select"), param: z.string() }),
  z.object({ type: z.literal("check"), param: z.string() }),
  z.object({ type: z.literal("click") }),
  z.object({ type: z.literal("upload"), param: z.string() }),
  z.object({ type: z.literal("userInput"), param: z.string(), prompt: z.string() }),
  z.object({ type: z.literal("waitFor"), condition: ConditionSchema }),
  z.object({ type: z.literal("extract") }),
]);

// ── 5. Semantic Step Contract ────────────────────────────────────────────────
const NO_LOCATOR_ACTIONS = new Set(["navigate", "waitFor", "extract"]);
export const StepContractSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "step id must be snake_case"),
    intent: z.string().min(1),
    action: ActionSchema,
    locators: z.array(LocatorSchema).max(5),
    pre: z.array(ConditionSchema),
    post: z.array(ConditionSchema),
    risk: RiskClassSchema,
    repair: RepairPolicySchema,
    sensitive: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .superRefine((s, ctx) => {
    if ((s.risk === "commit" || s.risk === "auth") && s.repair !== "human") {
      ctx.addIssue({ code: "custom", message: `step ${s.id}: repair must be "human" for ${s.risk}` });
    }
    if (!NO_LOCATOR_ACTIONS.has(s.action.type) && s.locators.length < 1) {
      ctx.addIssue({ code: "custom", message: `step ${s.id}: needs at least one locator` });
    }
  });

// ── 6. Tool and Site ─────────────────────────────────────────────────────────
export const JsonSchemaSchema = z.record(z.string(), z.unknown());

export const ToolSchema = z
  .object({
    id: z.string(),
    siteId: z.string(),
    name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
    title: z.string(),
    description: z.string(),
    version: z.number().int().min(1),
    status: ToolStatusSchema,
    inputSchema: JsonSchemaSchema,
    outputs: z.array(z.string()),
    startUrl: z.string(),
    steps: z.array(StepContractSchema).min(1),
    createdFrom: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const s of t.steps) {
      if (seen.has(s.id)) ctx.addIssue({ code: "custom", message: `duplicate step id ${s.id}` });
      seen.add(s.id);
    }
  });

export const SiteSchema = z.object({
  id: z.string(),
  origin: z.string(),
  slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  mode: z.enum(["owner", "user_only"]),
});

// ── 7. Recording ─────────────────────────────────────────────────────────────
export const ElementFingerprintSchema = z.object({
  tag: z.string(),
  type: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  testid: z.string().optional(),
  classes: z.array(z.string()),
  label: z.string().optional(),
  ariaLabel: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  nearText: z.string().optional(),
  cssPath: z.string(),
  xpath: z.string(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  inForm: z.string().optional(),
});

export const RecordedEventSchema = z.object({
  seq: z.number().int(),
  t: z.number(),
  type: z.enum(["navigate", "click", "input", "change", "submit", "keydown_enter"]),
  url: z.string(),
  target: ElementFingerprintSchema.optional(),
  value: z.string().optional(),
  domSnapshotBlobId: z.string().optional(),
});

export const RecordingSchema = z.object({
  id: z.string(),
  siteOrigin: z.string(),
  startUrl: z.string(),
  taskName: z.string(),
  events: z.array(RecordedEventSchema),
  createdAt: z.string(),
});

// ── 8. Runs, traces, needs ───────────────────────────────────────────────────
const CheckResultSchema = z.object({ ok: z.boolean(), detail: z.string().optional() });

export const StepTraceSchema = z.object({
  stepId: z.string(),
  status: z.enum(["passed", "failed", "skipped", "blocked_dry_run", "awaiting"]),
  usedLocator: LocatorSchema.optional(),
  preResults: z.array(CheckResultSchema),
  postResults: z.array(CheckResultSchema),
  startedAt: z.string(),
  durationMs: z.number(),
  error: z.string().optional(),
  evidenceBlobId: z.string().optional(),
});

export const PreviewItemSchema = z.object({ label: z.string(), value: z.string() });

export const NeedSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("confirmation"),
    stepId: z.string(),
    preview: z.array(PreviewItemSchema),
  }),
  z.object({
    kind: z.literal("user_input"),
    stepId: z.string(),
    param: z.string(),
    prompt: z.string(),
    sensitive: z.boolean(),
  }),
]);

export const RunSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  toolVersion: z.number().int(),
  mode: RunModeSchema,
  dryRun: z.boolean(),
  status: RunStatusSchema,
  need: NeedSchema.optional(),
  inputsRedacted: z.record(z.string(), z.string()),
  outputs: z.record(z.string(), z.string()),
  trace: z.array(StepTraceSchema),
  failedStepId: z.string().optional(),
  receiptId: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});

// ── 9. Receipts ──────────────────────────────────────────────────────────────
export const ReceiptSchema = z.object({
  id: z.string(),
  runId: z.string(),
  toolId: z.string(),
  toolVersion: z.number().int(),
  siteOrigin: z.string(),
  summary: z.array(PreviewItemSchema),
  outputs: z.record(z.string(), z.string()),
  traceHash: z.string(),
  issuedAt: z.string(),
  signature: z.string(),
  keyId: z.string(),
});

// ── 10. Repair ───────────────────────────────────────────────────────────────
export const RepairProposalSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  fromVersion: z.number().int(),
  stepId: z.string(),
  reason: z.string(),
  evidence: z.object({
    domSnapshotBlobId: z.string(),
    failedChecks: z.array(z.string()),
    screenshotBlobId: z.string().optional(),
  }),
  proposedStep: StepContractSchema,
  method: z.enum(["locator_fallback", "heuristic", "llm"]),
  confidence: z.number().min(0).max(1),
  sandbox: z.object({ passed: z.boolean(), detail: z.string() }),
  reversible: z.boolean(),
  status: z.enum(["pending", "auto_applied", "approved", "rejected", "needs_rerecord"]),
  createdAt: z.string(),
});

// ── 11. Audit ────────────────────────────────────────────────────────────────
export const AuditEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  siteId: z.string(),
  toolId: z.string().optional(),
  runId: z.string().optional(),
  actor: z.enum(["agent", "user", "owner", "system"]),
  action: z.string(),
  detail: z.string().optional(),
});

// ── 12. MCP tool result ──────────────────────────────────────────────────────
export const ToolCallResultSchema = z.object({
  run_id: z.string(),
  status: RunStatusSchema,
  message: z.string(),
  need: NeedSchema.optional(),
  outputs: z.record(z.string(), z.string()).optional(),
  receipt_id: z.string().optional(),
  error: z.string().optional(),
});

// ── Inferred types ───────────────────────────────────────────────────────────
export type RiskClass = z.infer<typeof RiskClassSchema>;
export type RepairPolicy = z.infer<typeof RepairPolicySchema>;
export type ToolStatus = z.infer<typeof ToolStatusSchema>;
export type RunMode = z.infer<typeof RunModeSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Locator = z.infer<typeof LocatorSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type StepContract = z.infer<typeof StepContractSchema>;
export type JSONSchema = z.infer<typeof JsonSchemaSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type Site = z.infer<typeof SiteSchema>;
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;
export type RecordedEvent = z.infer<typeof RecordedEventSchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type StepTrace = z.infer<typeof StepTraceSchema>;
export type PreviewItem = z.infer<typeof PreviewItemSchema>;
export type Need = z.infer<typeof NeedSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type RepairProposal = z.infer<typeof RepairProposalSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type ToolCallResult = z.infer<typeof ToolCallResultSchema>;
