CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"site_id" text NOT NULL,
	"tool_id" text,
	"run_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"json" jsonb NOT NULL,
	CONSTRAINT "receipts_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"site_origin" text NOT NULL,
	"json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repairs" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	CONSTRAINT "sites_origin_unique" UNIQUE("origin"),
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE INDEX "audit_site_idx" ON "audit_events" USING btree ("site_id","at");--> statement-breakpoint
CREATE INDEX "runs_tool_idx" ON "runs" USING btree ("tool_id","started_at");--> statement-breakpoint
CREATE INDEX "tools_site_idx" ON "tools" USING btree ("site_id");