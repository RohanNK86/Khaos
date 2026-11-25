import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AuditEvent, Recording, Receipt, RepairProposal, Run, Site, Tool, ToolStatus } from "@mcpify/contracts";
import type { Db } from "./db/client.js";
import { auditEvents, receipts, recordings, repairs, runs, sites, tools } from "./db/schema.js";

export type AuditInput = Omit<AuditEvent, "id" | "at">;

/** All database access. Rows keep the contract objects as JSON plus the columns we filter on. */
export class Store {
  constructor(readonly db: Db) {}

  // ── sites ──────────────────────────────────────────────────────────────────
  async listSites(): Promise<Site[]> {
    return this.db.select().from(sites).orderBy(sites.slug);
  }

  async getSite(id: string): Promise<Site | undefined> {
    return (await this.db.select().from(sites).where(eq(sites.id, id)))[0];
  }

  async siteByOrigin(origin: string): Promise<Site | undefined> {
    return (await this.db.select().from(sites).where(eq(sites.origin, origin)))[0];
  }

  async siteBySlug(slug: string): Promise<Site | undefined> {
    return (await this.db.select().from(sites).where(eq(sites.slug, slug)))[0];
  }

  /** Insert or update a site by id. */
  async putSite(site: Site): Promise<Site> {
    const { id, ...rest } = site;
    await this.db.insert(sites).values(site).onConflictDoUpdate({ target: sites.id, set: rest });
    return site;
  }

  // ── tools ──────────────────────────────────────────────────────────────────
  async insertToolVersion(tool: Tool): Promise<Tool> {
    await this.db.insert(tools).values(toolRow(tool));
    return tool;
  }

  /** Seed: write (id, version) from a fixture; keeps the stored status if the row exists. */
  async upsertToolVersion(tool: Tool): Promise<void> {
    await this.db
      .insert(tools)
      .values(toolRow(tool))
      .onConflictDoUpdate({
        target: [tools.id, tools.version],
        set: { siteId: tool.siteId, name: tool.name, json: sql`jsonb_set(excluded.json, '{status}', to_jsonb(${tools.status}))` },
      });
  }

  async latestTool(id: string): Promise<Tool | undefined> {
    const rows = await this.db.select().from(tools).where(eq(tools.id, id)).orderBy(desc(tools.version)).limit(1);
    return rows[0]?.json;
  }

  async toolVersion(id: string, version: number): Promise<Tool | undefined> {
    return (await this.db.select().from(tools).where(and(eq(tools.id, id), eq(tools.version, version))))[0]?.json;
  }

  async listLatestTools(filter: { siteId?: string; status?: ToolStatus } = {}): Promise<Tool[]> {
    const rows = await this.db.selectDistinctOn([tools.id]).from(tools).orderBy(tools.id, desc(tools.version));
    return rows
      .map((r) => r.json)
      .filter((t) => (!filter.siteId || t.siteId === filter.siteId) && (!filter.status || t.status === filter.status))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async countTools(): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(tools);
    return row?.n ?? 0;
  }

  /** Change the status of the latest version of a tool. */
  async setToolStatus(tool: Tool, status: ToolStatus): Promise<Tool> {
    const next: Tool = { ...tool, status, updatedAt: new Date().toISOString() };
    await this.db
      .update(tools)
      .set({ status, json: next })
      .where(and(eq(tools.id, tool.id), eq(tools.version, tool.version)));
    return next;
  }

  // ── recordings ─────────────────────────────────────────────────────────────
  async putRecording(rec: Recording): Promise<void> {
    await this.db
      .insert(recordings)
      .values({ id: rec.id, siteOrigin: rec.siteOrigin, json: rec, createdAt: rec.createdAt })
      .onConflictDoUpdate({ target: recordings.id, set: { json: rec } });
  }

  async getRecording(id: string): Promise<Recording | undefined> {
    return (await this.db.select().from(recordings).where(eq(recordings.id, id)))[0]?.json;
  }

  // ── runs ───────────────────────────────────────────────────────────────────
  async saveRun(run: Run): Promise<void> {
    await this.db
      .insert(runs)
      .values({ id: run.id, toolId: run.toolId, status: run.status, startedAt: run.startedAt, json: run })
      .onConflictDoUpdate({ target: runs.id, set: { status: run.status, json: run } });
  }

  async getRun(id: string): Promise<Run | undefined> {
    return (await this.db.select().from(runs).where(eq(runs.id, id)))[0]?.json;
  }

  async listRuns(filter: { toolId?: string; limit: number }): Promise<Run[]> {
    const q = this.db.select().from(runs);
    const rows = await (filter.toolId ? q.where(eq(runs.toolId, filter.toolId)) : q).orderBy(desc(runs.startedAt)).limit(filter.limit);
    return rows.map((r) => r.json);
  }

  // ── receipts ───────────────────────────────────────────────────────────────
  async saveReceipt(r: Receipt): Promise<void> {
    await this.db.insert(receipts).values({ id: r.id, runId: r.runId, json: r });
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    return (await this.db.select().from(receipts).where(eq(receipts.id, id)))[0]?.json;
  }

  async receiptOfRun(runId: string): Promise<Receipt | undefined> {
    return (await this.db.select().from(receipts).where(eq(receipts.runId, runId)))[0]?.json;
  }

  // ── repairs ────────────────────────────────────────────────────────────────
  async saveRepair(r: RepairProposal): Promise<void> {
    await this.db
      .insert(repairs)
      .values({ id: r.id, toolId: r.toolId, status: r.status, createdAt: r.createdAt, json: r })
      .onConflictDoUpdate({ target: repairs.id, set: { status: r.status, json: r } });
  }

  async getRepair(id: string): Promise<RepairProposal | undefined> {
    return (await this.db.select().from(repairs).where(eq(repairs.id, id)))[0]?.json;
  }

  async listRepairs(status?: RepairProposal["status"]): Promise<RepairProposal[]> {
    const q = this.db.select().from(repairs);
    const rows = await (status ? q.where(eq(repairs.status, status)) : q).orderBy(desc(repairs.createdAt));
    return rows.map((r) => r.json);
  }

  // ── audit ──────────────────────────────────────────────────────────────────
  async audit(e: AuditInput): Promise<void> {
    await this.db.insert(auditEvents).values({ ...e, id: randomUUID(), at: new Date().toISOString() });
  }

  async listAudit(filter: { siteId?: string; limit: number }): Promise<AuditEvent[]> {
    const q = this.db.select().from(auditEvents);
    const rows = await (filter.siteId ? q.where(eq(auditEvents.siteId, filter.siteId)) : q).orderBy(desc(auditEvents.at)).limit(filter.limit);
    return rows.map(({ toolId, runId, detail, at, ...rest }) => ({
      ...rest,
      at: new Date(at).toISOString(),
      ...(toolId ? { toolId } : {}),
      ...(runId ? { runId } : {}),
      ...(detail ? { detail } : {}),
    }));
  }
}

const toolRow = (t: Tool) => ({ id: t.id, version: t.version, siteId: t.siteId, name: t.name, status: t.status, json: t });
