import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { RepairProposal, Run } from "@mcpify/contracts";
import { createScholarshipPortal } from "@mcpify/portals";
import { FsBlobStore, LocalEd25519Signer } from "@mcpify/storage";
import { createApi, type Api } from "../src/app.js";
import { dropDatabase, recreateDatabase } from "../src/db/client.js";
import { loadFixtures } from "../src/seed.js";
import { setRepairHandler } from "../src/runs/repair-hook.js";
import { GOLDEN_APPLY } from "./helpers.js";

const DB = "mcpify_test_api_selfrepair";
const TOKEN = { "x-lab-token": "changeme", "content-type": "application/json" };
let portal: Server, base: string, api: Api;

beforeAll(async () => {
  portal = createScholarshipPortal().listen(0);
  const a = portal.address();
  base = `http://localhost:${typeof a === "object" && a ? a.port : 0}`;
  const dir = mkdtempSync(join(tmpdir(), "mcpify-selfrepair-"));
  api = await createApi({
    databaseUrl: await recreateDatabase(DB), headless: true, selfRepair: true,
    blobs: new FsBlobStore(join(dir, "blobs")), signer: new LocalEd25519Signer(join(dir, "keys")),
    fixtures: () => loadFixtures((raw) => raw.replaceAll("http://localhost:5101", base)),
  });
}, 60_000);
afterAll(async () => {
  setRepairHandler(null);
  await api?.close();
  await dropDatabase(DB);
  portal?.close();
});
beforeEach(async () => { await fetch(`${base}/__lab/reset`, { method: "POST", headers: TOKEN }); });

const mutate = (enable: string[]) => fetch(`${base}/__lab/mutations`, { method: "POST", headers: TOKEN, body: JSON.stringify({ enable, disable: [] }) });
const inputs = {
  applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210", email: "asha.demo@example.com",
  course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College", annual_income: 180000, category: "OBC", declaration: true,
};
const start = async (dryRun: boolean) =>
  (await api.app.inject({ method: "POST", url: "/runs", payload: { toolId: GOLDEN_APPLY, inputs, mode: "owner", dryRun } })).json() as Run;
const repairs = async () => (await api.app.inject({ method: "GET", url: "/repairs" })).json() as RepairProposal[];

test("M1+M2: the income step heals itself mid-run (tool v2) and the SAME run carries on", async () => {
  await mutate(["M1", "M2"]);
  const run = await start(true);
  expect(run.status).toBe("dry_run_complete");
  expect(run.toolVersion).toBe(2);
  const income = run.trace.filter((t) => t.stepId === "enter_annual_income").map((t) => t.status);
  expect(income).toEqual(["failed", "passed"]);
  const p = (await repairs()).find((r) => r.stepId === "enter_annual_income");
  expect(p).toMatchObject({ status: "auto_applied", method: "heuristic" });
  const state = (await (await fetch(`${base}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
  expect(state.applications).toHaveLength(0);
}, 120_000);

test("M8: a new required field stops the run safely (needs_rerecord), nothing auto-applied", async () => {
  await mutate(["M8"]);
  const run = await start(true);
  expect(run.status).toBe("failed");
  const p = (await repairs()).find((r) => r.stepId === run.failedStepId && r.status === "needs_rerecord");
  expect(p).toBeDefined();
}, 120_000);

test("M9: relabelled options heal via optionAliases (v2) and the agent keeps sending old labels", async () => {
  await mutate(["M9"]);
  const run = await start(true);

  expect(run.status).toBe("dry_run_complete");
  expect((await repairs()).some((r) => r.stepId === "select_course" && r.status === "auto_applied")).toBe(true);
}, 120_000);
