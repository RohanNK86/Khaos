import { readFile } from "node:fs/promises";
import type { AddressInfo, Server } from "node:net";
import type { BrowserContext } from "playwright";
import { ToolSchema, type Tool } from "@mcpify/contracts";
import type { RunHooks } from "@mcpify/engine";

export const root = new URL("../../../", import.meta.url);
export const LAB = { "x-lab-token": "changeme" };

export const portOf = (s: Server) => (s.address() as AddressInfo).port;

/** A golden tool from fixtures/tools, pointed at a test portal. */
export async function golden(name: string, base: string): Promise<Tool> {
  const raw = await readFile(new URL(`fixtures/tools/scholarship.${name}.v1.json`, root), "utf8");
  return ToolSchema.parse(JSON.parse(raw.replaceAll("http://localhost:5101", base))) as Tool;
}

export const applyInputs = {
  applicant_name: "Asha Demo", date_of_birth: "2005-04-12", gender: "Female", mobile: "9876543210",
  email: "asha.demo@example.com", course: "B.Sc", year_of_study: "2nd Year", institution_name: "Demo Government College",
  annual_income: 180000, category: "OBC", declaration: true, income_certificate: "sample-income-certificate.pdf",
};

/** Test-only hooks: approve, read OTP/CAPTCHA from the portal's lab endpoints. */
export function labHooks(ctx: BrowserContext, base: string): RunHooks {
  const lab = async (what: "otp" | "captcha") => {
    const sid = (await ctx.cookies()).find((c) => c.name === "ASP.NET_SessionId")!.value;
    return ((await (await fetch(`${base}/__lab/${what}?session=${sid}`, { headers: LAB })).json()) as Record<string, string>)[what]!;
  };
  return {
    async onNeed(n) {
      if (n.kind === "confirmation") return { approve: true };
      return { value: await lab(n.param === "otp" ? "otp" : "captcha") };
    },
    async loadFile(ref) {
      return { name: ref, mime: "application/pdf", bytes: await readFile(new URL(`fixtures/files/${ref}`, root)) };
    },
  };
}

export async function labState(base: string) {
  return (await (await fetch(`${base}/__lab/state`, { headers: LAB })).json()) as { applications: { applicationId: string }[] };
}
