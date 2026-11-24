import { createHash, randomUUID } from "node:crypto";
import { buildPreview, canonicalJson, type Receipt, type Run, type Tool } from "@mcpify/contracts";
import type { Signer } from "./signer.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const payload = (r: Omit<Receipt, "signature">) => Buffer.from(canonicalJson(r));

/** Issue a signed receipt for a succeeded run (01-CONTRACTS §9). */
export async function issueReceipt(signer: Signer, tool: Tool, run: Run, inputs: Record<string, unknown>, siteOrigin: string): Promise<Receipt> {
  const unsigned: Omit<Receipt, "signature"> = {
    id: randomUUID(),
    runId: run.id,
    toolId: tool.id,
    toolVersion: tool.version,
    siteOrigin,
    summary: buildPreview(tool, inputs),
    outputs: run.outputs,
    traceHash: sha256(canonicalJson(run.trace)),
    issuedAt: new Date().toISOString(),
    keyId: signer.keyId,
  };
  const { signature } = await signer.sign(payload(unsigned));
  return { ...unsigned, signature };
}

export async function verifyReceipt(signer: Signer, receipt: Receipt): Promise<boolean> {
  const { signature, ...rest } = receipt;
  return signer.verify(payload(rest), signature, receipt.keyId);
}
