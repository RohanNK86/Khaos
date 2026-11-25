import { afterAll, beforeAll, expect, test } from "vitest";
import type { Receipt, Run, Tool } from "@mcpify/contracts";
import { GOLDEN_APPLY, GOLDEN_STATUS, setupApi } from "./helpers.js";

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => { api = await setupApi("mcpify_test_api_runs"); });
afterAll(async () => { await api?.teardown(); });

const post = (url: string, payload: unknown) => api.app.inject({ method: "POST", url, payload: payload as object });
const get = (url: string) => api.app.inject({ method: "GET", url });

/** A client-side run (as the extension would report it) that passed every step. */
function reportedRun(tool: Tool, over: Partial<Run> = {}): Run {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), toolId: tool.id, toolVersion: tool.version, mode: "user", dryRun: false, status: "succeeded",
    inputsRedacted: { applicant_name: "Asha Demo" }, outputs: { application_id: "SSP-2026-000001" },
    trace: tool.steps.map((s) => ({ stepId: s.id, status: "passed" as const, preResults: [], postResults: [], startedAt: now, durationMs: 1 })),
    startedAt: now, endedAt: now, ...over,
  };
}

test("bad inputs are rejected before any browser work", async () => {
  const r = await post("/runs", { toolId: GOLDEN_APPLY, inputs: { course: "MBBS" }, mode: "owner", dryRun: true });
  expect(r.statusCode).toBe(400);
  expect(r.json().error).toMatch(/Please fix the inputs: .*course must be one of/);
});

test("unknown and non-approved tools cannot run", async () => {
  expect((await post("/runs", { toolId: "nope", inputs: {} })).statusCode).toBe(404);
  await post(`/tools/${GOLDEN_STATUS}/disable`, {});
  expect((await post("/runs", { toolId: GOLDEN_STATUS, inputs: {} })).statusCode).toBe(409);
  await post(`/tools/${GOLDEN_STATUS}/approve`, {});
});

test("continue/cancel of an unknown run is 404", async () => {
  expect((await post("/runs/nope/continue", { approve: true })).statusCode).toBe(404);
  expect((await post("/runs/nope/cancel", {})).statusCode).toBe(404);
});

test("POST /runs/report stores client-side runs; GET /runs filters by tool", async () => {
  const tool = (await get(`/tools/${GOLDEN_APPLY}`)).json() as Tool;
  const run = reportedRun(tool);
  expect((await post("/runs/report", run)).json()).toEqual({ id: run.id });
  expect((await get(`/runs/${run.id}`)).json()).toEqual(run);
  const list = (await get(`/runs?toolId=${tool.id}&limit=5`)).json() as Run[];
  expect(list.map((r) => r.id)).toContain(run.id);
  expect(((await get(`/runs?toolId=${GOLDEN_STATUS}`)).json() as Run[]).map((r) => r.id)).not.toContain(run.id);
  expect((await post("/runs/report", { id: "x" })).statusCode).toBe(400);
});

test("receipts: issue for a committed run, verify, tamper → invalid", async () => {
  const tool = (await get(`/tools/${GOLDEN_APPLY}`)).json() as Tool;
  const run = reportedRun(tool);
  await post("/runs/report", run);
  const receipt = (await post("/receipts/issue", { runId: run.id })).json() as Receipt;
  expect(receipt).toMatchObject({ runId: run.id, outputs: { application_id: "SSP-2026-000001" }, keyId: "local-ed25519-1" });
  expect((await post("/receipts/issue", { runId: run.id })).json()).toEqual(receipt); // idempotent
  expect((await get(`/receipts/${receipt.id}`)).json()).toEqual(receipt);
  expect((await post("/receipts/verify", receipt)).json()).toEqual({ valid: true });
  const tampered = { ...receipt, outputs: { application_id: "SSP-2026-999999" } };
  expect((await post("/receipts/verify", tampered)).json()).toEqual({ valid: false });
  expect((await get("/receipts/nope")).statusCode).toBe(404);
});

test("receipts are refused for runs without an executed commit step", async () => {
  const tool = (await get(`/tools/${GOLDEN_APPLY}`)).json() as Tool;
  const dry = reportedRun(tool, { status: "dry_run_complete" });
  await post("/runs/report", dry);
  expect((await post("/receipts/issue", { runId: dry.id })).statusCode).toBe(409);
});
