import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Recording, RepairProposal, Receipt, Run, Tool } from "@mcpify/contracts";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

export const sites = pgTable("sites", {
  id: text("id").primaryKey(),
  origin: text("origin").notNull().unique(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  mode: text("mode").$type<"owner" | "user_only">().notNull(),
});

/** One row per (tool id, version). "Latest" = the highest version of an id. */
export const tools = pgTable(
  "tools",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    siteId: text("site_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    json: jsonb("json").$type<Tool>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] }), index("tools_site_idx").on(t.siteId)],
);

export const recordings = pgTable("recordings", {
  id: text("id").primaryKey(),
  siteOrigin: text("site_origin").notNull(),
  json: jsonb("json").$type<Recording>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    toolId: text("tool_id").notNull(),
    status: text("status").notNull(),
    startedAt: ts("started_at").notNull(),
    json: jsonb("json").$type<Run>().notNull(),
  },
  (t) => [index("runs_tool_idx").on(t.toolId, t.startedAt)],
);

export const receipts = pgTable("receipts", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  json: jsonb("json").$type<Receipt>().notNull(),
});

export const repairs = pgTable("repairs", {
  id: text("id").primaryKey(),
  toolId: text("tool_id").notNull(),
  status: text("status").notNull(),
  createdAt: ts("created_at").notNull(),
  json: jsonb("json").$type<RepairProposal>().notNull(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    at: ts("at").notNull(),
    siteId: text("site_id").notNull(),
    toolId: text("tool_id"),
    runId: text("run_id"),
    actor: text("actor").$type<"agent" | "user" | "owner" | "system">().notNull(),
    action: text("action").notNull(),
    detail: text("detail"),
  },
  (t) => [index("audit_site_idx").on(t.siteId, t.at)],
);
