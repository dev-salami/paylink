import { describe, expect, it, vi } from "vitest";
import { createCachedRpcFetch, createRetryingRpcFetch, retryDelay } from "./rpc-fetch";
import { DEVNET_BUSY } from "./rpc-errors";

const endpoint = "https://rpc.example.test/private-test-key";

describe("bounded RPC transport", () => {
  it("honours Retry-After on 429, then succeeds with no real sleep/network", async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private details", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: "2.0", id: 1, result: 42 }));
    const sleep = vi.fn(async (_ms: number) => {});
    const request = createRetryingRpcFetch({ fetchImpl: upstream, sleep, random: () => 0 });
    expect(await (await request(endpoint)).json()).toMatchObject({ result: 42 });
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(upstream.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("retries 5xx, network failures and HTTP-200 JSON-RPC rate limits", async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(`fetch failed ${endpoint}`))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: { code: 429, message: "Too many requests" } }))
      .mockResolvedValueOnce(Response.json({ result: "ok" }));
    const sleep = vi.fn(async (_ms: number) => {});
    const request = createRetryingRpcFetch({ fetchImpl: upstream, sleep, random: () => 0 });
    expect(await (await request(endpoint)).json()).toMatchObject({ result: "ok" });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([300, 600, 1_200]);
  });

  it("bounds retries, hides upstream errors and does not retry permanent HTTP errors", async () => {
    const upstream = vi.fn<typeof fetch>(async () => new Response(endpoint, { status: 429 }));
    const request = createRetryingRpcFetch({ fetchImpl: upstream, sleep: async () => {}, random: () => 0 });
    await expect(request(endpoint)).rejects.toThrow(DEVNET_BUSY);
    expect(upstream).toHaveBeenCalledTimes(5);
    const permanent = vi.fn<typeof fetch>(async () => new Response(endpoint, { status: 403 }));
    await expect(createRetryingRpcFetch({ fetchImpl: permanent })(endpoint)).rejects.toThrow(DEVNET_BUSY);
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it("honours HTTP-date Retry-After and includes jitter", () => {
    const now = Date.parse("2026-11-07T00:00:00Z");
    expect(retryDelay(0, "Sat, 07 Nov 2026 00:00:03 GMT", now, () => 0)).toBe(3_000);
    expect(retryDelay(0, null, now, () => 0.5)).toBe(425);
  });

  it("does not violate a long cooldown by retrying early", async () => {
    const upstream = vi.fn<typeof fetch>(async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(createRetryingRpcFetch({ fetchImpl: upstream, sleep })(endpoint)).rejects.toThrow(DEVNET_BUSY);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("exact-key RPC caching", () => {
  const call = (id: number, method = "getBalance", params: unknown[] = ["wallet"]) => ({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  it("coalesces reads, rewrites IDs, and expires the short cache", async () => {
    let now = 0;
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ jsonrpc: "2.0", id: 1, result: { value: 42 } }));
    const request = createCachedRpcFetch({ fetchImpl: upstream, now: () => now });
    const responses = await Promise.all([request(endpoint, call(1)), request(endpoint, call(2))]);
    expect(await responses[0]!.json()).toMatchObject({ id: 1 });
    expect(await responses[1]!.json()).toMatchObject({ id: 2 });
    await request(endpoint, call(3));
    expect(upstream).toHaveBeenCalledTimes(1);
    now = 2_000;
    await request(endpoint, call(4));
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("caches mint lookups longer, but never caches or collapses transaction submissions", async () => {
    let now = 0;
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ result: { value: "data" } }));
    const request = createCachedRpcFetch({ fetchImpl: upstream, now: () => now, mint: "mint" });
    await request(endpoint, call(1, "getAccountInfo", ["mint"]));
    now = 10_000;
    await request(endpoint, call(2, "getAccountInfo", ["mint"]));
    expect(upstream).toHaveBeenCalledTimes(1);
    await Promise.all([request(endpoint, call(3, "sendTransaction", ["signed-tx"])), request(endpoint, call(4, "sendTransaction", ["signed-tx"]))]);
    expect(upstream).toHaveBeenCalledTimes(3);
  });
});
