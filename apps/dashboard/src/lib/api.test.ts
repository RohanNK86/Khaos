import { describe, expect, it, vi } from "vitest";
import { loadMockData } from "../mock/client";
import { ApiError, createHttpClient, queryString, type FetchLike } from "./api";

const data = loadMockData();
const tool = data.tools[0]!.versions[0]!;

function fakeFetch(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => new Response(body === undefined ? "" : JSON.stringify(body), { status }));
}

describe("createHttpClient", () => {
  it("GETs with query params and validates the response", async () => {
    const f = fakeFetch(200, [tool]);
    const tools = await createHttpClient("http://api:4000/", f).listTools({ siteId: "site-scholarship", status: "approved" });
    expect(tools[0]?.name).toBe("apply_scholarship");
    expect(f).toHaveBeenCalledWith("http://api:4000/tools?siteId=site-scholarship&status=approved", expect.objectContaining({ method: "GET" }));
  });

  it("POSTs JSON bodies", async () => {
    const f = fakeFetch(200, data.runs[1]);
    await createHttpClient("http://api", f).continueRun("run 1", { approve: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://api/runs/run%201/continue");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"approve":true}');
  });

  it("verifyReceipt returns { valid }", async () => {
    const f = fakeFetch(200, { valid: true });
    expect(await createHttpClient("http://api", f).verifyReceipt(data.receipts[0]!)).toEqual({ valid: true });
  });

  it("approveRepair parses { proposal, tool }", async () => {
    const f = fakeFetch(200, { proposal: data.repairs[0], tool });
    const res = await createHttpClient("http://api", f).approveRepair("rep-0001-pending");
    expect(res.tool.id).toBe(tool.id);
    expect(res.proposal.id).toBe("rep-0001-pending");
  });

  it("throws ApiError with the API's error message", async () => {
    const f = fakeFetch(404, { error: "tool not found" });
    const err = await createHttpClient("http://api", f).getTool("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("tool not found");
  });

  it("rejects responses that break the contract", async () => {
    const f = fakeFetch(200, [{ id: "s1" }]);
    await expect(createHttpClient("http://api", f).listSites()).rejects.toMatchObject({ status: 502 });
  });
});

describe("queryString", () => {
  it("skips empty values", () => {
    expect(queryString({ a: "1", b: undefined, c: "", d: 5 })).toBe("?a=1&d=5");
    expect(queryString({})).toBe("");
  });
});
