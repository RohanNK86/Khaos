import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { Run, Tool } from "@mcpify/contracts";
import { FsBlobStore, LocalEd25519Signer, issueReceipt, verifyReceipt } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "mcpify-storage-"));

test("blob store round-trips by sha256 id", async () => {
  const s = new FsBlobStore(join(dir, "blobs"));
  const id = await s.put("<html>hi</html>", "text/html");
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  expect((await s.get(id))?.content.toString()).toBe("<html>hi</html>");
  expect(await s.get("../etc/passwd")).toBeNull();
});

test("receipt verifies, and tampering breaks it", async () => {
  const signer = new LocalEd25519Signer(join(dir, "keys"));
  const tool = { id: "t", version: 1, steps: [], inputSchema: {} } as unknown as Tool;
  const run = { id: "r", outputs: { application_id: "SSP-2026-000123" }, trace: [] } as unknown as Run;
  const receipt = await issueReceipt(signer, tool, run, {}, "http://localhost:5101");
  expect(await verifyReceipt(signer, receipt)).toBe(true);
  expect(await verifyReceipt(signer, { ...receipt, outputs: { application_id: "SSP-2026-999999" } })).toBe(false);
});
