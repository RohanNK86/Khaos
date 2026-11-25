import { describe, expect, it } from "vitest";
import { loadMockData } from "../mock/client";
import {
  buildTimeline,
  changedStepIds,
  describeAction,
  describeCondition,
  describeLocator,
  formatDuration,
  recorderCommand,
  riskClass,
  runDurationMs,
  scriptTag,
  statusClass,
  stepDiff,
} from "./format";

const data = loadMockData();
const [v1, v2] = data.tools[0]!.versions;

describe("risk colours", () => {
  it("maps read=grey, fill=blue, commit=orange, auth=red", () => {
    expect(riskClass("read")).toContain("neutral");
    expect(riskClass("fill")).toContain("sky");
    expect(riskClass("commit")).toContain("orange");
    expect(riskClass("auth")).toContain("red");
  });
  it("has a fallback for unknown statuses", () => {
    expect(statusClass("succeeded")).toContain("green");
    expect(statusClass("whatever")).toBe("bg-white");
  });
});

describe("stepDiff", () => {
  const before = v1!.steps.find((s) => s.id === "enter_annual_income")!;
  const after = v2!.steps.find((s) => s.id === "enter_annual_income")!;
  it("marks only changed fields", () => {
    const diff = stepDiff(before, after);
    const changed = diff.filter((d) => d.changed).map((d) => d.field);
    expect(changed).toEqual(["locators", "pre", "post"]);
    expect(diff.find((d) => d.field === "locators")?.after.split("\n")[0]).toBe('label "Annual family income"');
  });
  it("handles a missing old step", () => {
    const diff = stepDiff(undefined, after);
    expect(diff.find((d) => d.field === "intent")).toMatchObject({ before: "—", changed: true });
    expect(diff.find((d) => d.field === "sensitive")).toMatchObject({ before: "—", after: "—", changed: false });
  });
  it("finds changed step ids between versions", () => {
    expect(changedStepIds(v1!, v2!)).toEqual(["enter_annual_income"]);
  });
});

describe("describers", () => {
  it("describes locators, conditions and actions", () => {
    expect(describeLocator({ kind: "role", role: "button", name: "Submit" })).toBe('role button "Submit"');
    expect(describeLocator({ kind: "near", anchorText: "Application ID", tag: "b" })).toBe('<b> near "Application ID"');
    expect(describeCondition({ kind: "urlMatches", pattern: "/done$" })).toBe("URL matches //done$/");
    expect(describeCondition({ kind: "visible", locators: [{ kind: "id", value: "a" }, { kind: "text", value: "A" }] })).toBe('visible @ id "a" (+1)');
    expect(describeAction({ type: "fill", param: "mobile" })).toBe("fill ← input.mobile");
    expect(describeAction({ type: "click" })).toBe("click");
  });
});

describe("runs", () => {
  it("builds a timeline with pending steps", () => {
    const run = data.runs.find((r) => r.status === "awaiting_confirmation")!;
    const t = buildTimeline(v2!, run);
    expect(t).toHaveLength(v2!.steps.length);
    expect(t[14]?.state).toBe("awaiting");
    expect(t[15]?.state).toBe("pending");
  });
  it("formats durations", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(95_000)).toBe("1 m 35 s");
    expect(formatDuration(37_847_000)).toBe("10 h 30 m");
    expect(runDurationMs({ startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:02Z" })).toBe(2000);
  });
});

describe("snippets", () => {
  it("builds the script tag and recorder command", () => {
    expect(scriptTag("https://api.example/", "scholarship")).toBe(
      '<script src="https://api.example/static/mcpify.js" data-site="scholarship" defer></script>',
    );
    expect(recorderCommand("fees", "check_dues")).toBe("pnpm --filter @mcpify/recorder record --site fees --task check_dues");
  });
});
