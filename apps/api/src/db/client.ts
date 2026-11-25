import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;
export const DEFAULT_DATABASE_URL = "postgres://mcpify:mcpify@localhost:5432/mcpify";
const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

/** Connect and bring the schema up to date (migrations run on every start; they are idempotent). */
export async function openDb(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<DbHandle> {
  const sql = postgres(url, { max: 10, onnotice: () => undefined });
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => sql.end({ timeout: 5 }) };
}

/** Tests: drop and recreate a scratch database next to the main one; returns its URL. */
export async function recreateDatabase(name: string, baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<string> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`bad database name ${name}`);
  const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function dropDatabase(name: string, baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): Promise<void> {
  const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}
