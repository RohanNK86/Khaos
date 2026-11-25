import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RepairProposal, StepContract, Tool } from "@mcpify/contracts";
import { decideRepairStatus } from "../src/routes/repairs.js";
import { GOLDEN_APPLY, setupApi } from "./helpers.js";

let api: Awaited<ReturnType<typeof setupApi>>;
let tool: Tool;
beforeAll(async () => {
  api = await setupApi("mcpify_test_api_repairs");
  tool = (await api.app.inject({ method: "GET", url: `/tools/${GOLDEN_APPLY}` })).json() as Tool;
});
afterAll(async () => { await api?.teardown(); });

const post = (url: string, payload: unknown = {}) => api.app.inject({ method: "POST", url, payload: payload as object });
const step = (id: string) => tool.steps.find((s) => s.id === id)!;

function proposal(stepId: string, over: Partial<RepairProposal> = {}): Omit<RepairProposal, "id" | "createdAt"> {
  const s: StepContract = step(stepId);
  return {
    toolId: tool.id, fromVersion: tool.version, stepId, reason: "locator not found",
    evidence: { domSnapshotBlobId: "a".repeat(64), failedChecks: ["no locator resolved"] },
    proposedStep: { ...s, locators: [{ kind: "css", value: "#new" }, ...s.locators] },
    method: "locator_fallback", confidence: 0.9, sandbox: { passed: true, detail: "ok" },
    reversible: true, status: "pending", ...over,
  };
}

describe("auto-apply rule (01-CONTRACTS §10)", () => {
  test.each([
    ["fill, passed, 0.9", "enter_applicant_name", {}, "auto_applied"],
    ["read, passed, 0.8", "read_application_id", { confidence: 0.8 }, "auto_applied"],
    ["fill, low confidence", "enter_applicant_name", { confidence: 0.79 }, "pending"],
    ["fill, sandbox failed", "enter_applicant_name", { sandbox: { passed: false, detail: "x" } }, "pending"],
    ["commit step", "send_otp", {}, "pending"],
    ["auth step", "enter_otp", {}, "pending"],
    ["needs_rerecord stays", "enter_applicant_name", { status: "needs_rerecord" as const }, "needs_rerecord"],
  ])("%s", (_name, stepId, over, expected) => {
    expect(decideRepairStatus(proposal(stepId, over), tool)).toBe(expected);
  });

  test("a fill step proposed as commit is not auto-applied", () => {
    const p = proposal("enter_applicant_name");
    expect(decideRepairStatus({ ...p, proposedStep: { ...p.proposedStep, risk: "commit", repair: "human" } }, tool)).toBe("pending");
  });
});

describe("repair endpoints", () => {
  test("auto-applied proposal patches the tool (version+1)", async () => {
    const r = (await post("/repairs", proposal("enter_email"))).json() as RepairProposal;
    expect(r.status).toBe("auto_applied");
    const latest = (await api.app.inject({ method: "GET", url: `/tools/${tool.id}` })).json() as Tool;
    expect(latest.version).toBe(tool.version + 1);
    expect(latest.steps.find((s) => s.id === "enter_email")!.locators[0]).toEqual({ kind: "css", value: "#new" });
  });

  test("pending → approve patches; pending → reject does not; double decisions are 409", async () => {
    const p1 = (await post("/repairs", proposal("send_otp"))).json() as RepairProposal;
    expect(p1.status).toBe("pending");
    const before = ((await api.app.inject({ method: "GET", url: `/tools/${tool.id}` })).json() as Tool).version;
    const ok = (await post(`/repairs/${p1.id}/approve`)).json() as { proposal: RepairProposal; tool: Tool };
    expect(ok.proposal.status).toBe("approved");
    expect(ok.tool.version).toBe(before + 1);
    expect((await post(`/repairs/${p1.id}/approve`)).statusCode).toBe(409);

    const p2 = (await post("/repairs", proposal("enter_mobile", { confidence: 0.1 }))).json() as RepairProposal;
    expect(((await post(`/repairs/${p2.id}/reject`)).json() as RepairProposal).status).toBe("rejected");
    const pending = (await api.app.inject({ method: "GET", url: "/repairs?status=pending" })).json() as RepairProposal[];
    expect(pending).toHaveLength(0);
    expect((await post("/repairs/nope/reject")).statusCode).toBe(404);
  });

  test("invalid proposals are 400", async () => {
    expect((await post("/repairs", { toolId: tool.id })).statusCode).toBe(400);
    expect((await post("/repairs", proposal("enter_email", { stepId: "nope" }))).statusCode).toBe(400);
  });
});
