/** Pure presentation helpers (no React), unit-tested. */
import type { Action, Condition, Locator, RiskClass, Run, RunStatus, StepContract, StepTrace, Tool } from "@mcpify/contracts";

/** Tailwind classes for a risk badge: read=grey, fill=blue, commit=orange, auth=red. */
export const RISK_CLASSES: Record<RiskClass, string> = {
  read: "bg-neutral-200 text-ink",
  fill: "bg-sky-200 text-ink",
  commit: "bg-orange text-ink",
  auth: "bg-red-400 text-ink",
};

export function riskClass(risk: RiskClass): string {
  return RISK_CLASSES[risk];
}

const STATUS_CLASSES: Record<string, string> = {
  succeeded: "bg-green-300",
  passed: "bg-green-300",
  approved: "bg-green-300",
  auto_applied: "bg-green-300",
  failed: "bg-red-400",
  rejected: "bg-red-400",
  disabled: "bg-neutral-300",
  stopped: "bg-neutral-300",
  skipped: "bg-neutral-300",
  running: "bg-yellow-200",
  draft: "bg-yellow-200",
  pending: "bg-orange",
  awaiting: "bg-orange",
  awaiting_confirmation: "bg-orange",
  awaiting_user_input: "bg-orange",
  repair_pending: "bg-orange",
  needs_rerecord: "bg-red-300",
  dry_run_complete: "bg-sky-200",
  blocked_dry_run: "bg-sky-200",
};

/** Background class for any status-like enum value (run, tool, trace, repair). */
export function statusClass(status: string): string {
  return STATUS_CLASSES[status] ?? "bg-white";
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

export function describeLocator(l: Locator): string {
  switch (l.kind) {
    case "role":
      return `role ${l.role} "${l.name}"`;
    case "near":
      return `<${l.tag}> near "${l.anchorText}"`;
    default:
      return `${l.kind} "${l.value}"`;
  }
}

/** First locator plus how many fallbacks follow: `label "Income" (+2)`. */
function locatorSummary(locators: Locator[]): string {
  const [first] = locators;
  if (!first) return "";
  return ` @ ${describeLocator(first)}${locators.length > 1 ? ` (+${locators.length - 1})` : ""}`;
}

export function describeCondition(c: Condition): string {
  return describeConditionKind(c) + ("locators" in c ? locatorSummary(c.locators) : "");
}

function describeConditionKind(c: Condition): string {
  switch (c.kind) {
    case "textPresent":
      return `text present "${c.text}"`;
    case "textAbsent":
      return `text absent "${c.text}"`;
    case "urlMatches":
      return `URL matches /${c.pattern}/`;
    case "valueEquals":
      return `value equals input.${c.param}`;
    case "extract":
      return `extract → outputs.${c.as}${c.pattern ? ` /${c.pattern}/` : ""}`;
    case "noErrorNear":
      return "no error near field";
    default:
      return c.kind;
  }
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case "navigate":
      return `navigate ${a.url}`;
    case "userInput":
      return `ask user: ${a.prompt} (→ ${a.param})`;
    case "waitFor":
      return `wait for ${describeCondition(a.condition)}`;
    case "click":
    case "extract":
      return a.type;
    default:
      return `${a.type} ← input.${a.param}`;
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} m ${Math.round(s % 60)} s` : `${Math.floor(m / 60)} h ${m % 60} m`;
}

/** Run duration; open runs measure until `now`. */
export function runDurationMs(run: Pick<Run, "startedAt" | "endedAt">, now = Date.now()): number {
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  return Math.max(0, end - Date.parse(run.startedAt));
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "stopped", "dry_run_complete"]);

export interface TimelineEntry {
  step: StepContract;
  trace?: StepTrace;
  /** Trace status, or "pending" for steps not reached yet. */
  state: StepTrace["status"] | "pending";
}

/** Joins a tool's steps with a run's trace, in step order. */
export function buildTimeline(tool: Pick<Tool, "steps">, run: Pick<Run, "trace">): TimelineEntry[] {
  const byId = new Map(run.trace.map((t) => [t.stepId, t]));
  return tool.steps.map((step) => {
    const trace = byId.get(step.id);
    return { step, trace, state: trace?.status ?? "pending" };
  });
}

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

const DIFF_FIELDS = ["intent", "action", "locators", "pre", "post", "risk", "repair", "sensitive", "timeoutMs"] as const;

function show(field: (typeof DIFF_FIELDS)[number], step: StepContract | undefined): string {
  if (!step) return "—";
  const v = step[field];
  if (v === undefined) return "—";
  if (field === "action") return describeAction(step.action);
  if (field === "locators") return step.locators.map(describeLocator).join("\n") || "—";
  if (field === "pre" || field === "post") return (v as Condition[]).map(describeCondition).join("\n") || "—";
  return String(v);
}

/** Field-by-field comparison of two versions of a step (old may be missing). */
export function stepDiff(before: StepContract | undefined, after: StepContract): FieldDiff[] {
  return DIFF_FIELDS.map((field) => {
    const b = show(field, before);
    const a = show(field, after);
    return { field, before: b, after: a, changed: b !== a };
  });
}

/** Step ids that differ between two tool versions (added, removed or changed). */
export function changedStepIds(before: Pick<Tool, "steps">, after: Pick<Tool, "steps">): string[] {
  const old = new Map(before.steps.map((s) => [s.id, JSON.stringify(s)]));
  const ids = new Set<string>();
  for (const s of after.steps) if (old.get(s.id) !== JSON.stringify(s)) ids.add(s.id);
  for (const id of old.keys()) if (!after.steps.some((s) => s.id === id)) ids.add(id);
  return [...ids];
}

/** The script tag a site owner pastes into their pages. */
export function scriptTag(apiOrigin: string, slug: string): string {
  return `<script src="${apiOrigin.replace(/\/+$/, "")}/static/mcpify.js" data-site="${slug}" defer></script>`;
}

export function recorderCommand(slug: string, task: string): string {
  return `pnpm --filter @mcpify/recorder record --site ${slug} --task ${task || "<task_name>"}`;
}

export function compilerCommand(recordingFile: string): string {
  return `pnpm --filter @mcpify/compiler compile --recording ${recordingFile}`;
}

export function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}
