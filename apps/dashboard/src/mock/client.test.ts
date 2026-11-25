import { describe, expect, it } from "vitest";
import { createMockClient } from "./client";

describe("mock client", () => {
  it("serves contract-valid data", async () => {
    const c = createMockClient();
    expect((await c.listTools({ status: "approved" })).map((t) => t.name)).toContain("apply_scholarship");
    expect((await c.getToolVersion("5c1a0b6e-0000-4000-8000-000000000001", 1)).version).toBe(1);
    expect(await c.listRepairs("pending")).toHaveLength(1);
  });

  it("approves a draft tool", async () => {
    const c = createMockClient();
    const [draft] = await c.listTools({ status: "draft" });
    expect((await c.approveTool(draft!.id)).status).toBe("approved");
    expect((await c.getTool(draft!.id)).status).toBe("approved");
  });

  it("approving a repair creates a new tool version", async () => {
    const c = createMockClient();
    const { tool, proposal } = await c.approveRepair("rep-0001-pending");
    expect(tool.version).toBe(3);
    expect(proposal.status).toBe("approved");
    expect(tool.steps.find((s) => s.id === "submit_application")?.locators[1]).toEqual({ kind: "role", role: "button", name: "Submit my application" });
  });

  it("verifies only untampered receipts", async () => {
    const c = createMockClient();
    const r = await c.getReceipt("rcpt-0001");
    expect(await c.verifyReceipt(r)).toEqual({ valid: true });
    expect(await c.verifyReceipt({ ...r, outputs: { application_id: "SSP-2026-999999" } })).toEqual({ valid: false });
  });

  it("returns 404 ApiErrors", async () => {
    await expect(createMockClient().getRun("nope")).rejects.toMatchObject({ status: 404 });
  });
});
