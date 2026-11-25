import { mkdtempSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createScholarshipPortal } from "@mcpify/portals";
import { FsBlobStore, LocalEd25519Signer } from "@mcpify/storage";
// The API is started in-process (relative import: @mcpify/api is not a declared dependency of this package).
import { createApi, dropDatabase, loadFixtures, recreateDatabase, type Api } from "@mcpify/api";
import { createMcpHttpApp } from "../src/index.js";

const TOKEN = { "x-lab-token": "changeme" };
const DB = "mcpify_test_mcp_e2e";
let portal: Server, mcpHttp: Server, portalBase: string, apiBase: string, client: Client, api: Api;
const port = (s: Server) => { const a = s.address(); return typeof a === "object" && a ? a.port : 0; };

beforeAll(async () => {
  portal = createScholarshipPortal().listen(0);
  portalBase = `http://localhost:${port(portal)}`;
  // API on a scratch database, seeded with the golden tools retargeted to the test portal port
  const dir = mkdtempSync(join(tmpdir(), "mcpify-e2e-"));
  api = await createApi({
    databaseUrl: await recreateDatabase(DB),
    headless: true,
    blobs: new FsBlobStore(join(dir, "blobs")),
    signer: new LocalEd25519Signer(join(dir, "keys")),
    fixtures: () => loadFixtures((raw) => raw.replaceAll("http://localhost:5101", portalBase)),
  });
  apiBase = await api.app.listen({ port: 0, host: "127.0.0.1" });
  const { app } = createMcpHttpApp({ apiUrl: apiBase });
  mcpHttp = app.listen(0);
  client = new Client({ name: "e2e", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port(mcpHttp)}/mcp`)));
}, 30_000);
afterAll(async () => {
  await client?.close();
  mcpHttp?.close();
  await api?.close();
  await dropDatabase(DB);
  portal?.close();
});

type R = { run_id: string; status: string; need?: { kind: string; param?: string; preview?: { label: string; value: string }[] }; outputs?: Record<string, string>; receipt_id?: string; message: string };
const call = async (name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse((res.content as { text: string }[])[0]!.text) as R & Record<string, unknown>;
};
const latestOtp = async () => {
  const html = await (await fetch(`${portalBase}/phone`)).text();
  return html.match(/(\d{6}) is your OTP/)![1]!;
};

const inputs = {
  applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "female", mobile: "9876543210",
  email: "asha.demo@example.com", course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College",
  annual_income: "1,80,000", category: "OBC", declaration: true,
};

test("tools/list shows approved tools plus the fixed tools", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining([
    "scholarship__apply_scholarship", "scholarship__check_application_status", "mcpify_continue", "mcpify_get_run", "mcpify_cancel", "mcpify_verify_receipt",
  ]));
});

test("apply via MCP: confirm → OTP → CAPTCHA → confirm → succeeded with a verified receipt", async () => {
  let r = await call("scholarship__apply_scholarship", inputs);
  expect(r.status).toBe("awaiting_confirmation");
  expect(r.need?.preview).toContainEqual({ label: "Annual family income (Rs)", value: "180000" });

  r = await call("mcpify_continue", { run_id: r.run_id, approve: true });
  expect(r).toMatchObject({ status: "awaiting_user_input", need: { param: "otp" } });
  const otp = await latestOtp();
  r = await call("mcpify_continue", { run_id: r.run_id, value: otp });
  expect(r).toMatchObject({ status: "awaiting_user_input", need: { param: "captcha" } });

  // the "human" reads the CAPTCHA: in tests we read it through the lab hook
  const runs = (await (await fetch(`http://localhost:${port(mcpHttp)}/api/runs`)).json()) as unknown[];
  expect(runs.length).toBeGreaterThan(0);
  const state = (await (await fetch(`${portalBase}/__lab/state`, { headers: TOKEN })).json()) as { applications: unknown[] };
  expect(state.applications).toHaveLength(0);
  const captcha = await captchaOfLatestSession();
  r = await call("mcpify_continue", { run_id: r.run_id, value: captcha });
  expect(r.status).toBe("awaiting_confirmation");
  r = await call("mcpify_continue", { run_id: r.run_id, approve: true });
  expect(r.status).toBe("succeeded");
  expect(r.outputs?.application_id).toMatch(/^SSP-2026-\d{6}$/);

  const v = await call("mcpify_verify_receipt", { receipt_id: r.receipt_id });
  expect(v.valid).toBe(true);

  // the OTP is never stored or returned (S8)
  const stored = await api.ctx.store.getRun(r.run_id);
  expect(stored?.status).toBe("succeeded");
  expect(stored?.receiptId).toBe(r.receipt_id);
  expect(JSON.stringify(stored)).not.toContain(otp);
  expect(await (await fetch(`${apiBase}/runs/${r.run_id}`)).text()).not.toContain(otp);
  const live = (await (await fetch(`http://localhost:${port(mcpHttp)}/api/runs`)).json()) as { id: string; toolName?: string; steps: unknown[] }[];
  expect(live.find((x) => x.id === r.run_id)).toMatchObject({ toolName: "apply_scholarship", steps: expect.any(Array) });

  const status = await call("scholarship__check_application_status", { application_id: r.outputs!.application_id, date_of_birth: "2005-04-12" });
  expect(status).toMatchObject({ status: "succeeded", outputs: { application_status: "Under verification" } });
}, 90_000);

test("declining the confirmation stops the run and sends nothing", async () => {
  let r = await call("scholarship__apply_scholarship", inputs);
  r = await call("mcpify_continue", { run_id: r.run_id, approve: false });
  expect(r.status).toBe("stopped");
}, 60_000);

test("dry run via MCP stops before Send OTP", async () => {
  const r = await call("scholarship__apply_scholarship", { ...inputs, mcpify_dry_run: true });
  expect(r.status).toBe("dry_run_complete");
  expect(r.message).toMatch(/Nothing was sent/);
}, 60_000);

test("bad inputs are rejected before any browser work", async () => {
  const res = await client.callTool({ name: "scholarship__apply_scholarship", arguments: { ...inputs, course: "MBBS" } });
  expect(res.isError).toBe(true);
  expect((res.content as { text: string }[])[0]!.text).toMatch(/course must be one of/);
});

/** Test-only: find the CAPTCHA of the session that is on page 3 (the lab hook needs a session id, so scan via state). */
async function captchaOfLatestSession(): Promise<string> {
  const res = await fetch(`${portalBase}/__lab/captcha?session=latest`, { headers: TOKEN });
  return ((await res.json()) as { captcha: string }).captcha;
}
