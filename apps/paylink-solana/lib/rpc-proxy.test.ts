import { describe, expect, it, vi } from "vitest";
import { handleRpcProxy } from "./rpc-proxy";
import { isPublicPath } from "./access";
import { DEVNET_BUSY } from "./rpc-errors";

const endpoint = () => "https://rpc.example.test/private-key";
const call = (method: string, id = 1) => ({ jsonrpc: "2.0", id, method, params: [] });
const request = (body: unknown) => new Request("https://pay.example/api/rpc", { method: "POST", headers: { origin: "https://pay.example" }, body: JSON.stringify(body) });

describe("public, tightly restricted same-origin RPC", () => {
  it.each(["getProgramAccounts", "requestAirdrop", "getTransaction", "getSignaturesForAddress"])("rejects %s before touching upstream", async (method) => {
    const upstream = vi.fn<typeof fetch>();
    const response = await handleRpcProxy(request(call(method)), endpoint, upstream);
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects oversized batches and an allowed/disallowed mixed batch atomically", async () => {
    const upstream = vi.fn<typeof fetch>();
    for (const body of [Array.from({ length: 11 }, (_, id) => call("getBalance", id)), [call("getBalance"), call("requestAirdrop")], []]) {
      expect((await handleRpcProxy(request(body), endpoint, upstream)).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("enforces the actual byte limit, including without Content-Length", async () => {
    const upstream = vi.fn<typeof fetch>();
    const response = await handleRpcProxy(request({ ...call("sendTransaction"), params: ["x".repeat(65_536)] }), endpoint, upstream);
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("allows wallet reads and sendTransaction, retaining each request ID", async () => {
    const upstream = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: body.id, result: "safe-result" });
    });
    const response = await handleRpcProxy(request([call("getLatestBlockhash", 1), call("sendTransaction", 2)]), endpoint, upstream);
    expect(await response.json()).toEqual([{ jsonrpc: "2.0", id: 1, result: "safe-result" }, { jsonrpc: "2.0", id: 2, result: "safe-result" }]);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("redacts upstream errors/keys and blocks cross-origin requests", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ error: { code: 429, message: `${endpoint()} Too Many Requests`, data: "private details" } }));
    const response = await handleRpcProxy(request(call("getBalance")), endpoint, upstream);
    const text = await response.text();
    expect(text).toContain(DEVNET_BUSY);
    expect(text).not.toContain("private");
    const crossOrigin = new Request("https://pay.example/api/rpc", { method: "POST", headers: { origin: "https://other.example" }, body: JSON.stringify(call("getBalance")) });
    expect((await handleRpcProxy(crossOrigin, endpoint, upstream)).status).toBe(403);
  });
  it("opens only the exact RPC endpoint through the existing merchant gate", () => {
    expect(isPublicPath("/api/rpc")).toBe(true);
    expect(isPublicPath("/api/rpc/private")).toBe(false);
    expect(isPublicPath("/api/invoices/sync-open")).toBe(false);
  });
  it("accepts the same external origin behind a TLS-terminating reverse proxy", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ result: 42 }));
    const proxied = new Request("http://localhost:3000/api/rpc", {
      method: "POST", headers: { origin: "https://pay.example", host: "pay.example", "x-forwarded-proto": "https" }, body: JSON.stringify(call("getBalance")),
    });
    expect((await handleRpcProxy(proxied, endpoint, upstream)).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
