"use server";
/** Mutations: each calls the API (or mock) and refreshes the affected pages. Local demo tool: no auth by design. */
import { revalidatePath } from "next/cache";
import { getSource } from "../lib/source";
import { errorMessage } from "../lib/server";

export interface ActionResult {
  ok: boolean;
  message: string;
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  if (typeof v !== "string" || !v) throw new Error(`missing form field ${name}`);
  return v;
}

async function run(paths: string[], fn: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function approveTool(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  return run(["/tools", `/tools/${id}`, "/sites"], async () => {
    const t = await (await getSource()).client.approveTool(id);
    return `${t.name} v${t.version} approved`;
  });
}

export async function disableTool(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  return run(["/tools", `/tools/${id}`, "/sites"], async () => {
    const t = await (await getSource()).client.disableTool(id);
    return `${t.name} disabled`;
  });
}

export async function approveRepair(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  return run(["/repairs", "/tools"], async () => {
    const { tool } = await (await getSource()).client.approveRepair(id);
    return `Patched: ${tool.name} is now v${tool.version}`;
  });
}

export async function rejectRepair(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  return run(["/repairs"], async () => {
    await (await getSource()).client.rejectRepair(id);
    return "Proposal rejected";
  });
}

export async function continueRun(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  const approve = form.get("approve");
  const value = form.get("value");
  return run([`/runs/${id}`, "/runs"], async () => {
    const r = await (await getSource()).client.continueRun(id, {
      ...(typeof approve === "string" ? { approve: approve === "true" } : {}),
      ...(typeof value === "string" && value ? { value } : {}),
    });
    return `Run is now ${r.status.replace(/_/g, " ")}`;
  });
}

export async function cancelRun(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  return run([`/runs/${id}`, "/runs"], async () => {
    const r = await (await getSource()).client.cancelRun(id);
    return `Run is now ${r.status}`;
  });
}

export async function verifyReceipt(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const id = field(form, "id");
  try {
    const { client } = await getSource();
    const { valid } = await client.verifyReceipt(await client.getReceipt(id));
    return { ok: valid, message: valid ? "Signature valid" : "Signature INVALID" };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
