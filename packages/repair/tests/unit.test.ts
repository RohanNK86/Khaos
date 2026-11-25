import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { chromium, type Browser } from "playwright";
import { StepContractSchema, type StepContract, type Tool } from "@mcpify/contracts";
import { setClaudeForTests, type ClaudeLike } from "@mcpify/llm";
import { applyOptionAliases, applyProposal, optionAliases, optionSim, repairStep, textSim } from "../src/index.js";
import { identSim } from "../src/text.js";

describe("similarity", () => {
  test("relabelled income field still looks alike", () => {
    expect(textSim("Annual family income", "Family Income (per annum)")).toBeGreaterThan(0.8);
    expect(textSim("Annual family income", "Institution Name")).toBeLessThan(0.4);
    expect(textSim("Next", "Continue")).toBeGreaterThan(0.6);
  });
  test("identifiers ignore legacy prefixes", () => {
    expect(identSim("ctl00_ContentPlaceHolder1_txtIncome", "ctl00_ContentPlaceHolder1_txtFamIncome")).toBeGreaterThan(0.6);
    expect(identSim("ctl00_ContentPlaceHolder1_txtIncome", "ctl00_ContentPlaceHolder1_txtInstitution")).toBeLessThan(0.4);
  });
  test("option abbreviations", () => {
    expect(optionSim("B.Sc", "Bachelor of Science")).toBeGreaterThan(0.9);
    expect(optionSim("B.Sc", "Bachelor of Commerce")).toBeLessThan(0.75);
    expect(optionSim("Diploma", "Diploma")).toBe(1);
  });
  test("option aliases round-trip through the proposal reason", () => {
    const reason = 'x → y option-aliases: {"course":{"B.Sc":"Bachelor of Science"}}';
    const al = optionAliases({ reason })!;
    expect(applyOptionAliases({ course: "B.Sc", other: 1 }, al)).toEqual({ course: "Bachelor of Science", other: 1 });
    expect(optionAliases({ reason: "nothing" })).toBeNull();
  });
});

// Tier 3 (LLM) with a mocked client: two equally plausible fields defeat the heuristic margin.
const step: StepContract = StepContractSchema.parse({
  id: "enter_reference", intent: "Fill the reference number", action: { type: "fill", param: "reference" },
  locators: [{ kind: "id", value: "refNo" }, { kind: "label", value: "Reference number" }],
  pre: [{ kind: "visible", locators: [{ kind: "id", value: "refNo" }, { kind: "label", value: "Reference number" }] }],
  post: [], risk: "fill", repair: "auto",
}) as StepContract;
const tool = {
  id: "t1", siteId: "s", name: "demo", title: "Demo", description: "", version: 3, status: "approved",
  inputSchema: { type: "object", properties: { reference: { type: "string" } } }, outputs: [],
  startUrl: "http://localhost:1/", steps: [step], createdAt: "", updatedAt: "",
} as Tool;
const html = `<html><body><form><table>
<tr><td>Reference no (old)</td><td><input id="refA" name="refA"/></td></tr>
<tr><td>Reference no (new)</td><td><input id="refB" name="refB"/></td></tr></table></form></body></html>`;

describe("tier 3 LLM", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });
  afterEach(() => { setClaudeForTests(null); delete process.env.LLM_DISABLED; });

  test("skipped cleanly when no LLM is available → pending, step unchanged", async () => {
    process.env.LLM_DISABLED = "1";
    const p = await repairStep({ tool, failedStepId: step.id, evidenceHtml: html, failedChecks: ["element not visible"], browser });
    expect(p.status).toBe("pending");
    expect(p.proposedStep).toEqual(step);
    expect(p.sandbox.passed).toBe(false);
  }, 30_000);

  test("mocked Claude picks a candidate → method llm, pending (owner reviews)", async () => {
    const prompts: string[] = [];
    const fake = {
      messages: {
        parse: async (req: { messages: { content: string }[] }) => {
          prompts.push(req.messages[0]!.content);
          return { parsed_output: { index: 1, reason: "the new reference field" }, stop_reason: "end_turn", usage: {} };
        },
        create: async () => { throw new Error("unused"); },
      },
    } as unknown as ClaudeLike; // only parse() is exercised
    setClaudeForTests(fake);
    const p = await repairStep({ tool, failedStepId: step.id, evidenceHtml: html, failedChecks: ["element not visible"], browser });
    expect(p.method).toBe("llm");
    expect(p.proposedStep.locators[0]).toEqual({ kind: "id", value: "refB" });
    expect(p.proposedStep.pre[0]).toMatchObject({ kind: "visible", locators: p.proposedStep.locators });
    expect(p.confidence).toBeLessThan(0.8);
    expect(p.status).toBe("pending");
    expect(prompts[0]).toContain("Reference no (new)");
    const patched = applyProposal(tool, p);
    expect(patched.version).toBe(4);
    expect(patched.steps[0]!.locators[0]).toEqual({ kind: "id", value: "refB" });
  }, 30_000);
});
