import type { ElementFingerprint, RecordedEvent, Tool } from '@mcpify/contracts';

/** Result of the optional validation run (engine, dry run, recorded example values). */
export interface ValidationResult {
  ok: boolean;
  status: string;
  passedSteps: string[];
  failedStepId?: string;
  error?: string;
  blockedRequests: number;
  at: string;
}

/**
 * Compiler output. Shaped like a Tool (03-DEMO-SPRINT §7): `id`, `version`, `createdAt`, `updatedAt` and `siteId`
 * may be missing; `mcp-server approve` fills them. `examples`, `warnings` and `validation` are draft-only extras
 * (ToolSchema strips them on approve).
 */
export type ToolDraft = Omit<Tool, 'id' | 'version' | 'status' | 'createdAt' | 'updatedAt' | 'siteId'> & {
  status: 'draft';
  siteId?: string;
  /** Recorded example inputs (sensitive params excluded). */
  examples: Record<string, unknown>;
  warnings: string[];
  validation?: ValidationResult;
  /** Set after the draft was posted to the API (so `approve <file>` approves that tool). */
  apiToolId?: string;
  /** draftHash() at posting time; a different hash means the owner edited the file. */
  apiToolHash?: string;
};

export interface CompileOptions {
  /** Load a DOM snapshot by blob id. Default: local blob dir, then GET /blobs/:id on the API. */
  loadSnapshot?: (blobId: string) => Promise<string | null>;
  /** Run the LLM pass when an LLM is available. Default true. */
  llm?: boolean;
  /** Site id for the draft (default: looked up by origin in fixtures/sites.json). */
  siteId?: string;
  /** Human-readable site name for the description. */
  siteName?: string;
}

export type StepKind = 'navigate' | 'fill' | 'select' | 'check' | 'upload' | 'userInput' | 'click' | 'radio';

/** One user action before it becomes a StepContract. */
export interface PlannedStep {
  kind: StepKind;
  event: RecordedEvent;
  target?: ElementFingerprint;
  value?: string;
  /** Snapshot the element is verified against (state just before / after the action). */
  snapshotId?: string;
  /** For clicks: where the page went. */
  after?: { url: string; navigated: boolean; snapshotId?: string };
  /** Snapshot taken before the action (for text diffs). */
  beforeId?: string;
}
