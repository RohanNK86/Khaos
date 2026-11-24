import { describe, expect, test } from "vitest";
import {
  ConditionSchema,
  LocatorSchema,
  NeedSchema,
  RecordingSchema,
  StepContractSchema,
  ToolCallResultSchema,
  ToolSchema,
  buildPreview,
  canonicalJson,
  mcpToolName,
  redactInputs,
  type Tool,
} from "./index.js";

const incomeStep = {
  id: "enter_annual_income",
  intent: "Fill the applicant's annual family income",
  action: { type: "fill", param: "annual_income" },
  locators: [
    { kind: "testid", value: "annual_income" },
    { kind: "id", value: "ctl00_ContentPlaceHolder1_txtIncome" },
    { kind: "label", value: "Annual family income" },
  ],
  pre: [{ kind: "visible", locators: [{ kind: "label", value: "Annual family income" }] }],
  post: [
    { kind: "valueEquals", locators: [{ kind: "id", value: "ctl00_ContentPlaceHolder1_txtIncome" }], param: "annual_income" },
    { kind: "noErrorNear", locators: [{ kind: "id", value: "ctl00_ContentPlaceHolder1_txtIncome" }] },
  ],
  risk: "fill",
  repair: "auto",
} as const;

const otpStep = {
  id: "enter_otp",
  intent: "Enter the OTP sent to the applicant's mobile",
  action: { type: "userInput", param: "otp", prompt: "Enter the 6-digit OTP" },
  locators: [{ kind: "label", value: "OTP" }],
  pre: [],
  post: [],
  risk: "auth",
  repair: "human",
  sensitive: true,
} as const;

const sampleTool = {
  id: "11111111-1111-1111-1111-111111111111",
  siteId: "site-1",
  name: "apply_scholarship",
  title: "Apply for State Scholarship",
  description: "Pauses for confirmation and OTP.",
  version: 1,
  status: "approved",
  inputSchema: {
    type: "object",
    properties: { annual_income: { type: "number", title: "Annual family income" }, otp: { type: "string", sensitive: true } },
    required: ["annual_income"],
  },
  outputs: ["application_id"],
  startUrl: "http://localhost:5101/apply/1",
  steps: [incomeStep, otpStep],
  createdAt: "2026-11-25T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z",
};

describe("schemas", () => {
  test("sample tool round-trips", () => {
    const t = ToolSchema.parse(sampleTool);
    expect(ToolSchema.parse(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  test("commit/auth steps must use human repair", () => {
    const bad = { ...otpStep, repair: "auto" };
    expect(StepContractSchema.safeParse(bad).success).toBe(false);
  });

  test("duplicate step ids are rejected", () => {
    expect(ToolSchema.safeParse({ ...sampleTool, steps: [incomeStep, incomeStep] }).success).toBe(false);
  });

  test("tool name format", () => {
    expect(ToolSchema.safeParse({ ...sampleTool, name: "Apply Scholarship" }).success).toBe(false);
  });

  test("interactive steps need locators", () => {
    expect(StepContractSchema.safeParse({ ...incomeStep, locators: [] }).success).toBe(false);
    expect(
      StepContractSchema.safeParse({
        id: "open", intent: "Open", action: { type: "navigate", url: "/" }, locators: [], pre: [], post: [], risk: "read", repair: "auto",
      }).success,
    ).toBe(true);
  });

  test("locators, conditions, needs, results", () => {
    expect(LocatorSchema.safeParse({ kind: "near", anchorText: "Income", tag: "input" }).success).toBe(true);
    expect(LocatorSchema.safeParse({ kind: "bogus", value: "x" }).success).toBe(false);
    expect(ConditionSchema.safeParse({ kind: "urlMatches", pattern: "/apply/2" }).success).toBe(true);
    expect(NeedSchema.safeParse({ kind: "user_input", stepId: "a", param: "otp", prompt: "p", sensitive: true }).success).toBe(true);
    expect(ToolCallResultSchema.safeParse({ run_id: "r", status: "succeeded", message: "ok" }).success).toBe(true);
    expect(ToolCallResultSchema.safeParse({ run_id: "r", status: "done", message: "ok" }).success).toBe(false);
  });

  test("recording", () => {
    expect(
      RecordingSchema.safeParse({
        id: "r1", siteOrigin: "http://localhost:5101", startUrl: "http://localhost:5101/", taskName: "x", createdAt: "now",
        events: [{ seq: 0, t: 0, type: "input", url: "u", value: "•••", target: { tag: "input", classes: [], cssPath: "#a", xpath: "//input" } }],
      }).success,
    ).toBe(true);
  });
});

describe("helpers", () => {
  const tool = ToolSchema.parse(sampleTool) as Tool;

  test("mcpToolName", () => {
    expect(mcpToolName({ slug: "scholarship" }, tool)).toBe("scholarship__apply_scholarship");
    expect(() => mcpToolName({ slug: "x".repeat(70) }, tool)).toThrow();
  });

  test("canonicalJson sorts keys", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });

  test("redactInputs masks sensitive values", () => {
    expect(redactInputs(tool, { annual_income: 180000, otp: "123456" })).toEqual({ annual_income: "180000", otp: "•••" });
  });

  test("buildPreview uses schema titles and skips user input", () => {
    expect(buildPreview(tool, { annual_income: 180000, otp: "123456" })).toEqual([
      { label: "Annual family income", value: "180000" },
    ]);
  });
});
