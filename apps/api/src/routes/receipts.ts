import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ReceiptSchema } from "@mcpify/contracts";
import { verifyReceipt } from "@mcpify/storage";
import type { Ctx } from "../context.js";
import { IdParams, Limit, found, notFound, parse } from "../http.js";
import { issueForRun } from "../receipts-service.js";

/** Signed receipts (01-CONTRACTS §9). */
export function receiptRoutes(app: FastifyInstance, { store, signer, runs }: Ctx): void {
  app.post("/receipts/issue", async (req) => {
    const { runId } = parse(z.object({ runId: z.string().min(1) }), req.body);
    const run = runs.get(runId) ?? (await store.getRun(runId));
    if (!run) throw notFound(`run ${runId}`);
    const tool = await store.toolVersion(run.toolId, run.toolVersion);
    if (!tool) throw notFound(`tool ${run.toolId} v${run.toolVersion}`);
    return issueForRun(store, signer, run, tool, runs.inputsOf(runId) ?? run.inputsRedacted);
  });

  app.get("/receipts", async (req) => store.listReceipts(parse(z.object({ limit: Limit }), req.query, "query").limit));

  app.get("/receipts/:id", async (req) => {
    const { id } = parse(IdParams, req.params, "params");
    return found(await store.getReceipt(id), `receipt ${id}`);
  });

  app.post("/receipts/verify", async (req) => ({ valid: await verifyReceipt(signer, parse(ReceiptSchema, req.body, "receipt")) }));
}
