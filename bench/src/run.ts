/**
 * MCPify benchmark (C16): every flow driven through a REAL MCP client → MCP server → API → engine → demo portal.
 *   pnpm --filter @mcpify/bench bench [--n 20] [--flows apply,status,dues,pay_dry,renew] [--no-repair]
 * Only our own demo portals. Headless, no action highlighting. Only measured numbers are written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApi, dropDatabase, loadFixtures, recreateDatabase, type Api } from "@mcpify/api";
import { createMcpHttpApp } from "@mcpify/mcp-server";
import { createBusPassPortal, createFeesPortal, createScholarshipPortal } from "@mcpify/portals";
import type { RepairProposal, Run, ToolCallResult } from "@mcpify/contracts";
import { mean, percentile, round } from "./stats.js";

process.env.LLM_DISABLED = "1";
const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const N = Number(opt("--n") ?? 20);
const FLOWS = (opt("--flows") ?? "apply,status,dues,pay_dry,renew").split(",");
const LAB = { "x-lab-token": process.env.LAB_TOKEN ?? "changeme" };
const OUT = new URL("../results/", import.meta.url).pathname;

const port = (s: Server) => { const a = s.address(); return typeof a === "object" && a ? a.port : 0; };
const listen = (app: { listen(p: number): Server }) => app.listen(0);

interface Env { portals: Record<"scholarship" | "fees" | "buspass", string>; api: Api; apiUrl: string; mcpUrl: string; close(): Promise<void> }

async function startEnv(db: string): Promise<Env> {
  const ps = { scholarship: listen(createScholarshipPortal()), fees: listen(createFeesPortal()), buspass: listen(createBusPassPortal()) };
  const portals = { scholarship: `http://localhost:${port(ps.scholarship)}`, fees: `http://localhost:${port(ps.fees)}`, buspass: `http://localhost:${port(ps.buspass)}` };
  const rewrite = (raw: string) => raw.replaceAll("http://localhost:5101", portals.scholarship).replaceAll("http://localhost:5102", portals.fees).replaceAll("http://localhost:5103", portals.buspass);
  const api = await createApi({ databaseUrl: await recreateDatabase(db), headless: true, showActions: false, fixtures: () => loadFixtures(rewrite) });
  await api.app.listen({ port: 0, host: "127.0.0.1" });
  const apiUrl = `http://127.0.0.1:${(api.app.server.address() as { port: number }).port}`;
  const mcp = createMcpHttpApp({ apiUrl, cacheMs: 0 });
  const mcpServer = mcp.app.listen(0);
  return {
    portals, api, apiUrl, mcpUrl: `http://localhost:${port(mcpServer)}/mcp`,
    async close() {
      mcpServer.close();
      await api.close();
      for (const s of Object.values(ps)) s.close();
      await dropDatabase(db);
    },
  };
}

const lab = async (base: string, what: string) => (await (await fetch(`${base}/__lab/${what}`, { headers: LAB })).json()) as Record<string, unknown>;
const reset = (base: string) => fetch(`${base}/__lab/reset`, { method: "POST", headers: LAB });
/** Records a flow creates: scholarship → applications, fees → payments, bus pass → renewals. */
const records = async (base: string) => {
  const s = await lab(base, "state");
  const key = ["payments", "renewals", "applications"].find((k) => Array.isArray(s[k]) && (k !== "applications" || !("payments" in s || "renewals" in s)))!;
  return (s[key] as unknown[]).length;
};

/** What the "human" answers (demo credentials from apps/portals/README.md; OTP/CAPTCHA read like a person would). */
async function answer(base: string, param: string): Promise<string> {
  const fixed: Record<string, string> = { password: "demo@123", card_number: "4111111111111111", card_expiry: "12/30", card_cvv: "123" };
  if (fixed[param]) return fixed[param]!;
  if (param === "otp") return String((await lab(base, "otp?session=latest")).otp);
  if (param === "captcha") return String((await lab(base, "captcha?session=latest")).captcha);
  throw new Error(`no answer for ${param}`);
}

interface Flow { id: string; tool: string; site: keyof Env["portals"]; dryRun: boolean; expectRecords: number; inputs(ctx: { appId?: string }): Record<string, unknown>; reset: boolean }
const APPLY = { applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210", email: "asha.demo@example.com", course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College", annual_income: 180000, category: "OBC", declaration: true };
const FLOW_DEFS: Flow[] = [
  { id: "apply", tool: "scholarship__apply_scholarship", site: "scholarship", dryRun: false, expectRecords: 1, reset: true, inputs: () => APPLY },
  { id: "status", tool: "scholarship__check_application_status", site: "scholarship", dryRun: false, expectRecords: 0, reset: false, inputs: (c) => ({ application_id: c.appId, date_of_birth: "2005-04-12" }) },
  { id: "dues", tool: "fees__check_dues", site: "fees", dryRun: false, expectRecords: 0, reset: true, inputs: () => ({ student_id: "DEMO2026001" }) },
  { id: "pay_dry", tool: "fees__pay_semester_fee", site: "fees", dryRun: true, expectRecords: 0, reset: true, inputs: () => ({ student_id: "DEMO2026001", name_on_card: "Asha Demo" }) },
  { id: "renew", tool: "buspass__renew_bus_pass", site: "buspass", dryRun: false, expectRecords: 1, reset: true,
    inputs: () => ({ pass_number: "BPS-2025-004217", date_of_birth: "2004-08-19", confirm_details: true, route: "Route 7: Old Bus Stand - Demo University", from_date: "2026-12-01", to_date: "2027-03-31" }) },
];

interface Sample { flow: string; ok: boolean; status: string; wallMs: number; roundTrips: number; pauses: number; steps: number; checks: number; error?: string }

async function runOnce(env: Env, client: Client, flow: Flow, ctx: { appId?: string }): Promise<Sample & { outputs?: Record<string, string> }> {
  const base = env.portals[flow.site];
  if (flow.reset) await reset(base);
  const before = await records(base);
  const call = async (name: string, a: Record<string, unknown>) => JSON.parse(((await client.callTool({ name, arguments: a })).content as { text: string }[])[0]!.text) as ToolCallResult;
  const t0 = performance.now();
  let roundTrips = 1, pauses = 0;
  let r = await call(flow.tool, { ...flow.inputs(ctx), ...(flow.dryRun ? { mcpify_dry_run: true } : {}) });
  while (r.status === "awaiting_confirmation" || r.status === "awaiting_user_input" || r.status === "running") {
    pauses += r.status === "running" ? 0 : 1;
    roundTrips++;
    if (r.status === "running") r = await call("mcpify_get_run", { run_id: r.run_id });
    else if (r.need?.kind === "confirmation") r = await call("mcpify_continue", { run_id: r.run_id, approve: true });
    else r = await call("mcpify_continue", { run_id: r.run_id, value: await answer(base, r.need?.kind === "user_input" ? r.need.param : "") });
  }
  const wallMs = performance.now() - t0;
  const run = (await (await fetch(`${env.apiUrl}/runs/${r.run_id}`)).json()) as Run;
  const created = (await records(base)) - before;
  const wantStatus = flow.dryRun ? "dry_run_complete" : "succeeded";
  const ok = r.status === wantStatus && created === flow.expectRecords;
  return {
    flow: flow.id, ok, status: r.status, wallMs, roundTrips, pauses, outputs: r.outputs,
    steps: run.trace.filter((t) => t.status === "passed").length,
    checks: run.trace.reduce((n, t) => n + t.preResults.length + t.postResults.length, 0),
    error: ok ? undefined : `${r.status} ${r.error ?? ""} created=${created}`,
  };
}

const MUTATIONS = [["M1"], ["M2"], ["M1", "M2"], ["M3"], ["M4"], ["M5"], ["M6"], ["M7"], ["M8"], ["M9"], ["M10"]];
interface RepairRow { mutation: string; outcome: string; runStatus: string; toolVersion: number; ms: number; method?: string; confidence?: number; repairStatus?: string }

async function repairBench(): Promise<RepairRow[]> {
  const rows: RepairRow[] = [];
  for (const m of MUTATIONS) {
    const env = await startEnv("mcpify_bench_repair"); // fresh DB → golden v1 every time
    try {
      const base = env.portals.scholarship;
      await reset(base);
      await fetch(`${base}/__lab/mutations`, { method: "POST", headers: { ...LAB, "content-type": "application/json" }, body: JSON.stringify({ enable: m, disable: [] }) });
      const t0 = performance.now();
      const res = await env.api.app.inject({ method: "POST", url: "/runs", payload: { toolId: "5c1a0b6e-0000-4000-8000-000000000001", inputs: APPLY, mode: "owner", dryRun: true } });
      const run = res.json() as Run;
      const ms = performance.now() - t0;
      const repairs = (await env.api.app.inject({ method: "GET", url: "/repairs" })).json() as RepairProposal[];
      const p = repairs[0];
      const healed = run.status === "dry_run_complete" && run.toolVersion > 1;
      const outcome = healed ? "healed in-run (tool v+1)" : run.status === "dry_run_complete" ? "passed unchanged" : run.status === "repair_pending" ? "repair pending (owner)" : p?.status === "needs_rerecord" ? "stopped safely: needs re-record" : `failed (${run.status})`;
      rows.push({ mutation: m.join("+"), outcome, runStatus: run.status, toolVersion: run.toolVersion, ms, method: p?.method, confidence: p?.confidence, repairStatus: p?.status });
      console.log(`[repair] ${m.join("+")}: ${outcome} (${Math.round(ms)} ms)`);
    } finally {
      await env.close();
    }
  }
  return rows;
}

async function main() {
  mkdirSync(join(OUT, "raw"), { recursive: true });
  const started = new Date();
  const env = await startEnv("mcpify_bench");
  const client = new Client({ name: "mcpify-bench", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(env.mcpUrl)));
  const samples: Sample[] = [];
  const ctx: { appId?: string } = {};
  try {
    for (const flow of FLOW_DEFS.filter((f) => FLOWS.includes(f.id))) {
      if (flow.id === "status") {
        await reset(env.portals.scholarship);
        ctx.appId = (await runOnce(env, client, FLOW_DEFS[0]!, ctx)).outputs?.application_id; // setup, not measured
      }
      for (let i = 0; i < N; i++) {
        const s = await runOnce(env, client, flow, ctx).catch((e: Error) => ({ flow: flow.id, ok: false, status: "error", wallMs: NaN, roundTrips: 0, pauses: 0, steps: 0, checks: 0, error: e.message }));
        samples.push(s);
        if (!s.ok) console.log(`[bench] ${flow.id} #${i + 1} FAILED: ${s.error}`);
      }
      const ok = samples.filter((s) => s.flow === flow.id && s.ok);
      console.log(`[bench] ${flow.id}: ${ok.length}/${N} ok, p50 ${Math.round(percentile(ok.map((s) => s.wallMs), 50))} ms`);
    }
  } finally {
    await client.close();
    await env.close();
  }
  const repairs = args.includes("--no-repair") ? [] : await repairBench();

  const flows = FLOWS.filter((f) => samples.some((s) => s.flow === f)).map((f) => {
    const all = samples.filter((s) => s.flow === f), ok = all.filter((s) => s.ok), w = ok.map((s) => s.wallMs);
    const def = FLOW_DEFS.find((d) => d.id === f)!;
    return { flow: f, tool: def.tool, dryRun: def.dryRun, n: all.length, success: ok.length, successRate: round(ok.length / all.length, 3),
      wallMsMean: round(mean(w)), wallMsP50: round(percentile(w, 50)), wallMsP95: round(percentile(w, 95)),
      steps: round(mean(ok.map((s) => s.steps)), 1), checks: round(mean(ok.map((s) => s.checks)), 1),
      pauses: round(mean(ok.map((s) => s.pauses)), 1), mcpRoundTrips: round(mean(ok.map((s) => s.roundTrips)), 1), modelCalls: 0 };
  });
  const env2 = { date: started.toISOString(), durationS: round((Date.now() - started.getTime()) / 1000), node: process.version, os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model, cores: cpus().length, ramGb: round(totalmem() / 2 ** 30, 1), browser: "Chromium (Playwright 1.65.1), headless, no highlighting", llm: "none configured (LLM_DISABLED=1)" };
  writeFileSync(join(OUT, "raw", `samples-${started.getTime()}.json`), JSON.stringify(samples, null, 2));
  writeFileSync(join(OUT, "summary.json"), JSON.stringify({ environment: env2, flows, repairs, baseline: "not run: needs an LLM key and approval (see bench/README.md)" }, null, 2) + "\n");
  writeFileSync(join(OUT, "summary.md"), markdown(env2, flows, repairs));
  console.log(`[bench] wrote ${join(OUT, "summary.md")}`);
}

function markdown(env: Record<string, unknown>, flows: Record<string, unknown>[], repairs: RepairRow[]): string {
  const row = (cells: unknown[]) => `| ${cells.join(" | ")} |`;
  const lines = [
    "# MCPify benchmark results (measured)", "",
    `Measured ${env.date} on ${env.os}, ${env.cpu} (${env.cores} cores, ${env.ramGb} GB), Node ${env.node}. ${env.browser}. LLM: ${env.llm}. Total ${env.durationS} s.`,
    "Path measured: MCP client → MCP server (streamable HTTP) → API → engine → demo portal. Wall time = first tool call → terminal status, including the bench's instant answers to pauses (a real user adds their own think time).", "",
    "## Flows",
    row(["flow", "tool", "dry run", "n", "success", "mean ms", "p50 ms", "p95 ms", "steps verified", "checks", "pauses", "MCP round trips", "model calls"]),
    row(Array(13).fill("---")),
    ...flows.map((f) => row([f.flow, `\`${f.tool}\``, f.dryRun ? "yes" : "no", f.n, `${f.success}/${f.n}`, f.wallMsMean, f.wallMsP50, f.wallMsP95, f.steps, f.checks, f.pauses, f.mcpRoundTrips, f.modelCalls])),
    "", "## Layout changes (Layout Lab, apply_scholarship in dry run, self-repair on, fresh tool v1 each time)",
    row(["mutation", "outcome", "run status", "tool version after", "ms", "repair method", "confidence", "proposal status"]),
    row(Array(8).fill("---")),
    ...repairs.map((r) => row([r.mutation, r.outcome, r.runStatus, r.toolVersion, Math.round(r.ms), r.method ?? "-", r.confidence ?? "-", r.repairStatus ?? "-"])),
    "", "## Baseline (computer-use agent)", "Not run: it needs an LLM key and your approval for the cost. See bench/README.md.", "",
  ];
  return lines.join("\n");
}

await main();
