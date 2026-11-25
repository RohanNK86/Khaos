import { requestSource } from "../../../../lib/server";
import { apiUrl } from "../../../../lib/source";

/** Evidence blobs (DOM snapshots): proxied from the API, or a placeholder in mock mode. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { mock } = await requestSource();
  if (mock) {
    const body = `<!doctype html><title>Mock blob ${id}</title><body style="font-family:system-ui;background:#F8F2E4;padding:2rem"><h1>Mock DOM snapshot</h1><p>Blob <code>${encodeURIComponent(id)}</code> would be served by <code>GET /blobs/:id</code> on the API.</p></body>`;
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const res = await fetch(`${apiUrl({ API_URL: process.env.API_URL })}/blobs/${encodeURIComponent(id)}`, { cache: "no-store" });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "content-security-policy": "sandbox" },
  });
}
