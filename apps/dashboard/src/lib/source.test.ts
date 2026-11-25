import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./api";
import { isMockForced, probe, resolveSource } from "./source";

const ok: FetchLike = async () => Response.json({ ok: true });
const down: FetchLike = async () => {
  throw new TypeError("fetch failed");
};

describe("mock-mode switch", () => {
  it("is forced by NEXT_PUBLIC_MOCK=1 or MCPIFY_MOCK=true", () => {
    expect(isMockForced({ NEXT_PUBLIC_MOCK: "1" })).toBe(true);
    expect(isMockForced({ MCPIFY_MOCK: "true" })).toBe(true);
    expect(isMockForced({ NEXT_PUBLIC_MOCK: "0" })).toBe(false);
    expect(isMockForced({})).toBe(false);
  });

  it("uses mock data when forced, without probing", async () => {
    const f = vi.fn(ok);
    const s = await resolveSource({ NEXT_PUBLIC_MOCK: "1" }, f);
    expect(s.mock).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect((await s.client.listSites()).length).toBeGreaterThan(0);
  });

  it("uses the real API when /health answers", async () => {
    const f = vi.fn(ok);
    const s = await resolveSource({ API_URL: "http://api:4000" }, f);
    expect(s.mock).toBe(false);
    expect(f.mock.calls[0]?.[0]).toBe("http://api:4000/health");
  });

  it("falls back to mock data when the API is unreachable", async () => {
    const s = await resolveSource({ API_URL: "http://api:4000" }, down);
    expect(s.mock).toBe(true);
    expect(s.reason).toContain("http://api:4000");
  });

  it("probe treats non-2xx as down", async () => {
    expect(await probe("http://api", async () => new Response("", { status: 500 }))).toBe(false);
  });
});
