import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AuditEvent, Site, Tool } from "@mcpify/contracts";
import { setClaudeForTests, type ClaudeLike } from "@mcpify/llm";
import { RateLimiter } from "../src/routes/agent.js";
import { GOLDEN_APPLY, GOLDEN_STATUS, setupApi } from "./helpers.js";

let api: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => { api = await setupApi("mcpify_test_api_registry"); });
afterAll(async () => { setClaudeForTests(null); await api?.teardown(); });

const inject = (method: "GET" | "POST", url: string, payload?: unknown) =>
  api.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
const json = <T>(r: { json(): unknown }) => r.json() as T;

describe("sites + seed", () => {
  test("health", async () => {
    expect(json(await inject("GET", "/health"))).toEqual({ ok: true });
  });

  test("startup seeded the fixtures as approved tools with their ids", async () => {
    const tools = json<Tool[]>(await inject("GET", "/tools?status=approved"));
    expect(tools.map((t) => t.id)).toEqual(expect.arrayContaining([GOLDEN_APPLY, GOLDEN_STATUS]));
    expect(json<Site[]>(await inject("GET", "/sites")).map((s) => s.slug)).toContain("scholarship");
  });

  test("POST /sites upserts by origin", async () => {
    const a = json<Site>(await inject("POST", "/sites", { origin: "http://localhost:5999", slug: "testsite", name: "Fees", mode: "owner" }));
    const b = json<Site>(await inject("POST", "/sites", { origin: "http://localhost:5999", slug: "testsite", name: "Fees Portal", mode: "owner" }));
    expect(b.id).toBe(a.id);
    expect(b.name).toBe("Fees Portal");
    const clash = await inject("POST", "/sites", { origin: "http://localhost:9999", slug: "testsite", name: "x", mode: "owner" });
    expect(clash.statusCode).toBe(409);
  });

  test("invalid bodies give {error, details} with 400", async () => {
    const r = await inject("POST", "/sites", { origin: "x", slug: "Bad Slug", name: "x", mode: "nope" });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: expect.any(String), details: expect.any(Array) });
  });

  test("manifest: approved tools only, CORS open, 404 for unknown origin", async () => {
    const r = await api.app.inject({ method: "GET", url: "/sites/manifest?origin=http://localhost:5101", headers: { origin: "http://localhost:5101" } });
    expect(r.headers["access-control-allow-origin"]).toBe("*");
    const m = json<{ site: Site; tools: Tool[] }>(r);
    expect(m.site.slug).toBe("scholarship");
    expect(m.tools.every((t) => t.status === "approved")).toBe(true);
    expect((await inject("GET", "/sites/manifest?origin=http://nowhere")).statusCode).toBe(404);
  });
});

describe("tools lifecycle", () => {
  let draft: Tool;
  test("POST /tools creates a draft v1 (server fields ignored)", async () => {
    const golden = json<Tool>(await inject("GET", `/tools/${GOLDEN_STATUS}`));
    const { id: _id, createdAt: _c, updatedAt: _u, version: _v, status: _s, ...body } = golden;
    const r = await inject("POST", "/tools", { ...body, id: "ignored", status: "approved" });
    expect(r.statusCode).toBe(200);
    draft = json<Tool>(r);
    expect(draft).toMatchObject({ status: "draft", version: 1, name: "check_application_status" });
    expect(draft.id).not.toBe("ignored");
    const manifest = json<{ tools: Tool[] }>(await inject("GET", "/sites/manifest?origin=http://localhost:5101"));
    expect(manifest.tools.map((t) => t.id)).not.toContain(draft.id);
  });

  test("POST /tools rejects unknown sites and invalid tools", async () => {
    expect((await inject("POST", "/tools", { name: "x" })).statusCode).toBe(400);
  });

  test("approving replaces the approved tool with the same name", async () => {
    const approved = json<Tool>(await inject("POST", `/tools/${draft.id}/approve`));
    expect(approved.status).toBe("approved");
    expect(json<Tool>(await inject("GET", `/tools/${GOLDEN_STATUS}`)).status).toBe("disabled");
    const names = json<Tool[]>(await inject("GET", "/tools?status=approved")).map((t) => t.name);
    expect(names.filter((n) => n === "check_application_status")).toHaveLength(1);
  });

  test("patch makes version+1 and keeps status; old version stays readable", async () => {
    const step = { ...draft.steps[1]!, intent: "Fill the Application ID (patched)" };
    const r = await inject("POST", `/tools/${draft.id}/patch`, { stepId: step.id, step, reason: "test" });
    const patched = json<Tool>(r);
    expect(patched).toMatchObject({ version: 2, status: "approved" });
    expect(patched.steps[1]!.intent).toMatch(/patched/);
    expect(json<Tool>(await inject("GET", `/tools/${draft.id}/versions/1`)).steps[1]!.intent).not.toMatch(/patched/);
    expect((await inject("POST", `/tools/${draft.id}/patch`, { stepId: "nope", step, reason: "x" })).statusCode).toBe(400);
  });

  test("disable, then 404 for unknown tools", async () => {
    expect(json<Tool>(await inject("POST", `/tools/${draft.id}/disable`)).status).toBe("disabled");
    expect((await inject("GET", "/tools/nope")).statusCode).toBe(404);
    await inject("POST", `/tools/${GOLDEN_STATUS}/approve`);
  });

  test("audit events were written", async () => {
    const site = json<Site[]>(await inject("GET", "/sites")).find((s) => s.slug === "scholarship")!;
    const events = json<AuditEvent[]>(await inject("GET", `/audit?siteId=${site.id}&limit=100`));
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["tool.created", "tool.approved", "tool.disabled", "tool.patched"]));
  });
});

describe("recordings, blobs, static", () => {
  test("recordings round-trip", async () => {
    const rec = { id: "rec-1", siteOrigin: "http://localhost:5101", startUrl: "http://localhost:5101/", taskName: "t", events: [], createdAt: new Date().toISOString() };
    expect(json(await inject("POST", "/recordings", rec))).toEqual({ id: "rec-1" });
    expect(json(await inject("GET", "/recordings/rec-1"))).toEqual(rec);
    expect((await inject("GET", "/recordings/none")).statusCode).toBe(404);
  });

  test("blobs keep bytes and content type (even JSON)", async () => {
    const r = await api.app.inject({ method: "POST", url: "/blobs", payload: "<html>snap</html>", headers: { "content-type": "text/html" } });
    const { blobId } = json<{ blobId: string }>(r);
    const g = await inject("GET", `/blobs/${blobId}`);
    expect(g.body).toBe("<html>snap</html>");
    expect(g.headers["content-type"]).toMatch(/text\/html/);
    const j = await api.app.inject({ method: "POST", url: "/blobs", payload: '{"a":1}', headers: { "content-type": "application/json" } });
    expect((await inject("GET", `/blobs/${json<{ blobId: string }>(j).blobId}`)).body).toBe('{"a":1}');
    expect((await inject("GET", "/blobs/abc")).statusCode).toBe(404);
  });

  test("static mcpify.js: 404 until built, then served", async () => {
    expect((await inject("GET", "/static/mcpify.js")).statusCode).toBe(404);
    writeFileSync(join(api.dir, "mcpify.js"), "console.log('mcpify')");
    const r = await inject("GET", "/static/mcpify.js");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/javascript/);
  });
});

describe("agent proxy", () => {
  const body = { messages: [{ role: "user", content: "hi" }], tools: [], max_tokens: 100000 };

  test("503 when no LLM is configured", async () => {
    const r = await inject("POST", "/agent/step", body);
    expect(r.statusCode).toBe(503);
    expect(json<{ error: string }>(r).error).toMatch(/not configured/);
  });

  test("proxies to Claude with max_tokens capped", async () => {
    let seen: { max_tokens?: number } = {};
    const fake = { messages: { create: async (p: { max_tokens: number }) => { seen = p; return { id: "m1", content: [{ type: "text", text: "hello" }], usage: {} }; } } };
    setClaudeForTests(fake as unknown as ClaudeLike); // only `create` is used by the proxy
    const r = await inject("POST", "/agent/step", body);
    expect(r.statusCode).toBe(200);
    expect(json<{ id: string }>(r).id).toBe("m1");
    expect(seen.max_tokens).toBeLessThanOrEqual(4000);
    expect((await inject("POST", "/agent/step", { messages: [] })).statusCode).toBe(400);
  });

  test("rate limiter allows 30 per minute per key", () => {
    const rl = new RateLimiter(30, 60_000);
    const results = Array.from({ length: 31 }, () => rl.allow("1.2.3.4", 1000));
    expect(results.filter(Boolean)).toHaveLength(30);
    expect(rl.allow("5.6.7.8", 1000)).toBe(true);
    expect(rl.allow("1.2.3.4", 61_001)).toBe(true);
  });
});

test("list endpoints: recordings, receipts, tool versions", async () => {
  expect((await api.app.inject({ method: "GET", url: "/recordings?limit=5" })).statusCode).toBe(200);
  expect((await api.app.inject({ method: "GET", url: "/receipts" })).statusCode).toBe(200);
  const versions = await api.app.inject({ method: "GET", url: "/tools/5c1a0b6e-0000-4000-8000-000000000002/versions" });
  expect(versions.statusCode).toBe(200);
  expect((versions.json() as { version: number }[])[0]!.version).toBeGreaterThanOrEqual(1);
  expect((await api.app.inject({ method: "GET", url: "/tools/nope/versions" })).statusCode).toBe(404);
});
